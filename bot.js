const { execSync } = require('child_process');
const IRC = require('irc-framework');
const fs = require('fs');
const dns = require('dns').promises;

const CACHE_FILE = 'ip_cache.json';

// Load configuration
const config = JSON.parse(fs.readFileSync('config.json', 'utf8'));


// Function to perform a git pull and check for updates
function checkForUpdatesAndRestart() {
  try {
    console.log('Checking for updates...');
    const output = execSync('git pull', { encoding: 'utf8' });

    console.log(output);

    if (!output.includes('Already up to date')) {
      console.log('Updates detected, restarting the bot...');
      process.exit(0); // Exit the process; assume a restart mechanism is in place
    } else {
      console.log('No updates found, continuing.');
    }
  } catch (error) {
    console.error('Error checking for updates:', error);
  }
}

// Call the function at the start
if (config.autoUpdate) {
  checkForUpdatesAndRestart();
}

// Load cache file or initialize an empty cache
let cache = {};
if (fs.existsSync(CACHE_FILE)) {
  cache = JSON.parse(fs.readFileSync(CACHE_FILE, 'utf8'));
}

const client = new IRC.Client();

client.connect({
  host: config.server,
  port: config.port,
  nick: config.nickname,
  username: config.username,
  realname: config.realname,
  password: config.password,
  auto_reconnect: true,
});

// Save cache to file
function saveCache() {
  fs.writeFileSync(CACHE_FILE, JSON.stringify(cache, null, 2), 'utf8');
}

// Helper function to resolve hostname to IPv4
async function resolveToIP(hostname) {
  try {
    const addresses = await dns.resolve(hostname); // Resolves both IPv4 and IPv6
    return addresses[0]; // Use the first resolved IP
  } catch (error) {
    console.error(`Failed to resolve ${hostname} to an IP address:`, error);
    return null;
  }
}


// Helper function to query the VPN API
async function queryVpnApi(ipv4Address) {
    const fetch = (await import('node-fetch')).default;
    const url = `https://vpnapi.io/api/${ipv4Address}?key=${config.apiKey}`;
    try {
      const response = await fetch(url);
      if (!response.ok) {
        throw new Error(`Failed to fetch data: ${response.statusText}`);
      }
      const data = await response.json();
      cache[ipv4Address] = data.security;
      saveCache();
      return data.security;
    } catch (error) {
      console.error(`Error querying VPN API for ${ipv4Address}:`, error);
      return null;
    }
  }
  

client.on('registered', () => {
  console.log(`Connected to ${config.server} as ${config.nickname}`);
});

client.on('join', async (event) => {
  if (event.nick === config.nickname) {
    return;
  }

  // Check if the user is in the exemptUsers list
  if (config.exemptUsers.includes(event.nick)) {
    console.log(`User ${event.nick} is exempt from checks.`);
    return;
  }

  const userHost = event.hostname;

  if (!userHost) {
    console.log(`No hostname information for user ${event.nick}, aborting process.`);
    return;
  }

  let ipAddress = userHost;

  // If it's a hostname, resolve to an IP address (IPv4 or IPv6)
  if (isNaN(parseInt(userHost.replace(/[\.:]/g, '')))) {
    ipAddress = await resolveToIP(userHost);
    if (!ipAddress) {
      console.log(`No valid IP address found for ${userHost}, aborting process.`);
      return;
    }
  }

  console.log(`User ${event.nick} joined with IP address: ${ipAddress}`);

  // Check if IP is in cache
  let securityInfo = cache[ipAddress];

  if (!securityInfo) {
    // IP is not in cache, query the API
    securityInfo = await queryVpnApi(ipAddress);
  } else {
    console.log(`Using cached security information for ${ipAddress}`);
  }

  if (securityInfo) {
    console.log(`Security information for ${ipAddress}:`, securityInfo);

    if (securityInfo.vpn || securityInfo.proxy || securityInfo.tor || securityInfo.relay) {
      client.say('ChanServ', `QUIET ${event.channel} ${event.nick}`);

      // Send a private message to each user in the notifyUsers array
      config.notifyUsers.forEach(user => {
        client.say(
          user,
          `User ${event.nick} joined with IP ${ipAddress} and triggered a security flag: VPN=${securityInfo.vpn}, Proxy=${securityInfo.proxy}, Tor=${securityInfo.tor}, Relay=${securityInfo.relay}`
        );
      });
    }
  } else {
    console.log(`No security information available for ${ipAddress}`);
  }

});

client.on('message', (event) => {
  console.log(`Message from ${event.nick}: ${event.message}`);

  // Respond to a specific command
  if (event.message === '!hello') {
    client.say(event.target, `Hello, ${event.nick}!`);
  }
});

client.on('error', (error) => {
  console.error('Error:', error);
});


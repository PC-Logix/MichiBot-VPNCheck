const IRC = require('irc-framework');
const fs = require('fs');
const dns = require('dns').promises;

const CACHE_FILE = 'ip_cache.json';

// Load configuration
const config = JSON.parse(fs.readFileSync('config.json', 'utf8'));

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
async function resolveToIPv4(hostname) {
  try {
    const addresses = await dns.resolve4(hostname);
    return addresses[0];
  } catch (error) {
    console.error(`Failed to resolve ${hostname} to IPv4:`, error);
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

  const userHost = event.hostname;

  if (!userHost) {
    console.log(`No hostname information for user ${event.nick}, aborting process.`);
    return;
  }

  if (userHost.includes(':')) {
    console.log(`User ${event.nick} has an IPv6 address, aborting process.`);
    return;
  }

  let ipv4Address = userHost;

  if (isNaN(parseInt(userHost.replace(/\./g, '')))) {
    ipv4Address = await resolveToIPv4(userHost);
    if (!ipv4Address) {
      console.log(`No valid IPv4 address found for ${userHost}, aborting process.`);
      return;
    }
  }

  console.log(`User ${event.nick} joined with IPv4 address: ${ipv4Address}`);

  // Check if IP is in cache
  let securityInfo = cache[ipv4Address];

  if (!securityInfo) {
    // IP is not in cache, query the API
    securityInfo = await queryVpnApi(ipv4Address);
  } else {
    console.log(`Using cached security information for ${ipv4Address}`);
  }

  if (securityInfo) {
    console.log(`Security information for ${ipv4Address}:`, securityInfo);

    if (securityInfo.vpn || securityInfo.proxy || securityInfo.tor || securityInfo.relay) {
      //client.raw(`MODE ${event.channel} +q ${event.nick}`);
      client.say('ChanServ', `QUIET ${event.channel} ${event.nick}`);
        // Send a private message to each user in the notifyUsers array
        config.notifyUsers.forEach(user => {
            client.say(
            user,
            `User ${event.nick} joined with IPv4 ${ipv4Address} and triggered a security flag: VPN=${securityInfo.vpn}, Proxy=${securityInfo.proxy}, Tor=${securityInfo.tor}, Relay=${securityInfo.relay}`
            );
        });
    }
  } else {
    console.log(`No security information available for ${ipv4Address}`);
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


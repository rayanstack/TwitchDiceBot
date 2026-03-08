const net = require("net");
const fs = require("fs");
const path = require("path");
require("dotenv").config();

const HOST = "irc.chat.twitch.tv";
const PORT = 6667;

const BOT_USERNAME = (process.env.BOT_USERNAME || "").toLowerCase();
const OAUTH_TOKEN = process.env.OAUTH_TOKEN || "";
const CHANNEL = (process.env.CHANNEL || "").toLowerCase();
const WHITELIST_USERNAME = (process.env.WHITELIST_USERNAME || "").toLowerCase();
const STARTING_WALLET = Number(process.env.STARTING_WALLET || 1000);

if (!BOT_USERNAME || !OAUTH_TOKEN || !CHANNEL || !WHITELIST_USERNAME) {
  console.error("Missing required values in .env");
  process.exit(1);
}

const balancesPath = path.join(__dirname, "balances.json");

function loadBalances() {
  try {
    const raw = fs.readFileSync(balancesPath, "utf8");
    return JSON.parse(raw);
  } catch (err) {
    return {};
  }
}

function saveBalances(data) {
  fs.writeFileSync(balancesPath, JSON.stringify(data, null, 2));
}

const balances = loadBalances();

function getUser(username) {
  const key = username.toLowerCase();

  if (!balances[key]) {
    balances[key] = {
      wallet: STARTING_WALLET,
      vault: 0,
      totalWon: 0,
      totalLost: 0,
      rolls: 0
    };
    saveBalances(balances);
  }

  return balances[key];
}

function sendMessage(socket, channel, message) {
  socket.write(`PRIVMSG #${channel} :${message}\r\n`);
}

function parsePrivMsg(line) {
  const match = line.match(/^:([^!]+)![^ ]+ PRIVMSG #([^ ]+) :(.+)$/);
  if (!match) return null;

  return {
    username: match[1].toLowerCase(),
    channel: match[2].toLowerCase(),
    message: match[3]
  };
}

function isAllowed(username) {
  return username.toLowerCase() === WHITELIST_USERNAME;
}

function parseAmount(raw) {
  const n = Number(raw);
  if (!Number.isFinite(n) || !Number.isInteger(n) || n <= 0) return null;
  return n;
}

function formatBal(username, user) {
  return `@${username} 💰 Wallet: ${user.wallet} | 🏦 Vault: ${user.vault}`;
}

function handleRoll(socket, username, channel, amount, user) {
  if (!amount) {
    sendMessage(socket, channel, `@${username} Usage: !roll <amount>`);
    return;
  }

  if (user.wallet < amount) {
    sendMessage(socket, channel, `@${username} Not enough in wallet. ${formatBal(username, user)}`);
    return;
  }

  const roll = Math.floor(Math.random() * 100) + 1;
  user.rolls += 1;

  let profit = 0;
  let resultText = "";

  if (roll <= 49) {
    profit = -amount;
    user.wallet += profit;
    user.totalLost += amount;
    resultText = `rolled ${roll} 🎲 and LOST ${amount}`;
  } else if (roll <= 74) {
    profit = amount;
    user.wallet += profit;
    user.totalWon += amount;
    resultText = `rolled ${roll} 🎲 and WON ${amount}`;
  } else if (roll <= 89) {
    profit = amount * 2;
    user.wallet += profit;
    user.totalWon += profit;
    resultText = `rolled ${roll} 🎲 and WON ${profit}`;
  } else if (roll <= 97) {
    profit = amount * 3;
    user.wallet += profit;
    user.totalWon += profit;
    resultText = `rolled ${roll} 🎲 and WON ${profit}`;
  } else {
    profit = amount * 5;
    user.wallet += profit;
    user.totalWon += profit;
    resultText = `rolled ${roll} 🎰 JACKPOT! WON ${profit}`;
  }

  saveBalances(balances);
  sendMessage(
    socket,
    channel,
    `@${username} ${resultText} | 💰 Wallet: ${user.wallet} | 🏦 Vault: ${user.vault}`
  );
}

function handleCommand(socket, username, channel, message) {
  if (!isAllowed(username)) return;

  const parts = message.trim().split(/\s+/);
  const cmd = (parts[0] || "").toLowerCase();
  const amount = parseAmount(parts[1]);

  const user = getUser(username);

  if (cmd === "!bal") {
    sendMessage(socket, channel, formatBal(username, user));
    return;
  }

  if (cmd === "!vault") {
    if (!amount) {
      sendMessage(socket, channel, `@${username} Usage: !vault <amount>`);
      return;
    }

    if (user.wallet < amount) {
      sendMessage(socket, channel, `@${username} Not enough in wallet. ${formatBal(username, user)}`);
      return;
    }

    user.wallet -= amount;
    user.vault += amount;
    saveBalances(balances);

    sendMessage(
      socket,
      channel,
      `@${username} moved ${amount} to the vault 🏦 | 💰 Wallet: ${user.wallet} | 🏦 Vault: ${user.vault}`
    );
    return;
  }

  if (cmd === "!unvault") {
    if (!amount) {
      sendMessage(socket, channel, `@${username} Usage: !unvault <amount>`);
      return;
    }

    if (user.vault < amount) {
      sendMessage(socket, channel, `@${username} Not enough in vault. ${formatBal(username, user)}`);
      return;
    }

    user.vault -= amount;
    user.wallet += amount;
    saveBalances(balances);

    sendMessage(
      socket,
      channel,
      `@${username} pulled ${amount} from the vault 📤 | 💰 Wallet: ${user.wallet} | 🏦 Vault: ${user.vault}`
    );
    return;
  }

  if (cmd === "!roll") {
    handleRoll(socket, username, channel, amount, user);
    return;
  }

  if (cmd === "!stats") {
    sendMessage(
      socket,
      channel,
      `@${username} 📊 Rolls: ${user.rolls} | Total Won: ${user.totalWon} | Total Lost: ${user.totalLost} | 💰 Wallet: ${user.wallet} | 🏦 Vault: ${user.vault}`
    );
    return;
  }

  if (cmd === "!resetbal") {
    balances[username] = {
      wallet: STARTING_WALLET,
      vault: 0,
      totalWon: 0,
      totalLost: 0,
      rolls: 0
    };
    saveBalances(balances);

    sendMessage(
      socket,
      channel,
      `@${username} balance reset. 💰 Wallet: ${STARTING_WALLET} | 🏦 Vault: 0`
    );
    return;
  }
}

const socket = net.createConnection(PORT, HOST, () => {
  console.log("Connected to Twitch IRC");

  socket.write(`PASS ${OAUTH_TOKEN}\r\n`);
  socket.write(`NICK ${BOT_USERNAME}\r\n`);
  socket.write(`JOIN #${CHANNEL}\r\n`);
});

socket.on("data", (buffer) => {
  const lines = buffer.toString().split("\r\n").filter(Boolean);

  for (const line of lines) {
    console.log(line);

    if (line.startsWith("PING")) {
      socket.write("PONG :tmi.twitch.tv\r\n");
      continue;
    }

    const parsed = parsePrivMsg(line);
    if (!parsed) continue;
    if (parsed.channel !== CHANNEL) continue;

    handleCommand(socket, parsed.username, parsed.channel, parsed.message);
  }
});

socket.on("error", (err) => {
  console.error("Socket error:", err.message);
});

socket.on("close", () => {
  console.log("Disconnected from Twitch IRC");
});
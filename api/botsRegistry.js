const fs = require("fs");

const BASE_DIR = global.directory || __dirname + "/..";
const REGISTRY_DIR = BASE_DIR + "/database";
const REGISTRY_FILE = REGISTRY_DIR + "/bots.json";

function ensure() {
  if (!fs.existsSync(REGISTRY_DIR)) fs.mkdirSync(REGISTRY_DIR);
  if (!fs.existsSync(REGISTRY_FILE)) fs.writeFileSync(REGISTRY_FILE, JSON.stringify({ tokens: [] }));
}

function read() {
  ensure();
  try {
    const raw = fs.readFileSync(REGISTRY_FILE, "utf-8");
    const data = JSON.parse(raw || "{}");
    if (!data.tokens || !Array.isArray(data.tokens)) data.tokens = [];
    return data;
  } catch (e) {
    return { tokens: [] };
  }
}

function write(data) {
  ensure();
  fs.writeFileSync(REGISTRY_FILE, JSON.stringify({ tokens: Array.from(new Set(data.tokens || [])) }));
}

function getAllTokens() {
  return read().tokens;
}

function addToken(token) {
  if (!token) return false;
  const data = read();
  if (!data.tokens.includes(token)) data.tokens.push(token);
  write(data);
  return true;
}

function removeToken(token) {
  const data = read();
  data.tokens = data.tokens.filter((t) => t !== token);
  write(data);
}

module.exports = { getAllTokens, addToken, removeToken };

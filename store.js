const fs = require('fs');
const path = require('path');

const DATA_DIR = path.join(__dirname, 'data');
const DB_FILE = path.join(DATA_DIR, 'students.json');

let students = [];
let writeTimer = null;

function load() {
  try {
    if (fs.existsSync(DB_FILE)) {
      const raw = fs.readFileSync(DB_FILE, 'utf8');
      const parsed = JSON.parse(raw);
      students = Array.isArray(parsed) ? parsed : [];
      console.log(`✓ Loaded ${students.length} student record(s) from disk`);
    }
  } catch (error) {
    console.error('Failed to load student store:', error.message);
    students = [];
  }
}

function persist() {
  clearTimeout(writeTimer);
  writeTimer = setTimeout(() => {
    try {
      if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true });
      fs.writeFileSync(DB_FILE, JSON.stringify(students, null, 2));
    } catch (error) {
      console.error('Failed to persist student store:', error.message);
    }
  }, 200);
}

function all() {
  return students;
}

function find(id) {
  return students.find(s => s.id === id);
}

function add(student) {
  students.push(student);
  persist();
  return student;
}

function update(id, patch) {
  const student = find(id);
  if (student) {
    Object.assign(student, patch);
    persist();
  }
  return student;
}

function remove(id) {
  students = students.filter(s => s.id !== id);
  persist();
}

function normalizeStr(str) {
  return (str || '').trim().toUpperCase();
}

function findByLRN(lrn) {
  const normalized = (lrn || '').trim();
  if (!normalized) return null;
  return students.find(s => (s.lrn || '').trim() === normalized) || null;
}

function findByName(firstName, lastName) {
  const fn = normalizeStr(firstName);
  const ln = normalizeStr(lastName);
  if (!fn || !ln) return null;
  return students.find(s => normalizeStr(s.firstName) === fn && normalizeStr(s.lastName) === ln) || null;
}

function checkDuplicate(firstName, lastName, lrn, excludeId) {
  const lrnMatch = findByLRN(lrn);
  const nameMatch = findByName(firstName, lastName);

  const matches = [];
  let matchedByLRN = false;
  let matchedByName = false;

  if (lrnMatch && lrnMatch.id !== excludeId) {
    matchedByLRN = true;
    matches.push(lrnMatch);
  }

  if (nameMatch && nameMatch.id !== excludeId) {
    matchedByName = true;
    if (!matches.find(m => m.id === nameMatch.id)) {
      matches.push(nameMatch);
    }
  }

  return {
    isDuplicate: matches.length > 0,
    matchedByName,
    matchedByLRN,
    matches
  };
}

load();

module.exports = { all, find, add, update, remove, findByLRN, findByName, checkDuplicate };

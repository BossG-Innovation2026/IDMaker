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

load();

module.exports = { all, find, add, update, remove };

const Database = require('better-sqlite3');
const db = new Database(':memory:');
db.exec("CREATE TABLE test (id INT)");
db.exec("INSERT INTO test VALUES (1)");

const stmt1 = db.prepare("SELECT * FROM test");
console.log("SELECT readonly:", stmt1.readonly);

const stmt2 = db.prepare("WITH x AS (SELECT 1) DELETE FROM test");
console.log("WITH DELETE readonly:", stmt2.readonly);

const stmt3 = db.prepare("UPDATE test SET id = 2");
console.log("UPDATE readonly:", stmt3.readonly);

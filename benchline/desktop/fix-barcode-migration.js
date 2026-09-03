const fs = require('fs');

const schemaPath = 'src/main/schema.sql';
let schema = fs.readFileSync(schemaPath, 'utf8');
const schemaLines = schema.split('\n').filter(
  (line) => !line.includes('CREATE UNIQUE INDEX IF NOT EXISTS idx_products_barcode')
);
fs.writeFileSync(schemaPath, schemaLines.join('\n'));
console.log('schema.sql fixed');

const dbPath = 'src/main/db.js';
let db = fs.readFileSync(dbPath, 'utf8');
const oldBlock = "  if (!hasColumn('products', 'barcode')) {\n    db.exec('ALTER TABLE products ADD COLUMN barcode TEXT');\n    db.exec('CREATE UNIQUE INDEX IF NOT EXISTS idx_products_barcode ON products(barcode) WHERE barcode IS NOT NULL');\n  }";
const newBlock = "  if (!hasColumn('products', 'barcode')) {\n    db.exec('ALTER TABLE products ADD COLUMN barcode TEXT');\n  }\n  db.exec('CREATE UNIQUE INDEX IF NOT EXISTS idx_products_barcode ON products(barcode) WHERE barcode IS NOT NULL');";

if (db.includes(oldBlock)) {
  db = db.replace(oldBlock, newBlock);
  fs.writeFileSync(dbPath, db);
  console.log('db.js fixed');
} else {
  console.log('db.js: expected old code not found -- may already be fixed, or file differs. Check manually.');
}

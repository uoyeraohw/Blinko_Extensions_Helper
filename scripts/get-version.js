#!/usr/bin/env node

const fs = require('fs');
const path = require('path');

try {
  const manifestPath = path.join(__dirname, '..', 'manifest.json');
  const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
  
  if (!manifest.version) {
    console.error('❌ Error: manifest.json 中没有找到 version 字段');
    process.exit(1);
  }
  
  console.log(manifest.version);
  process.exit(0);
} catch (error) {
  console.error('❌ Error:', error.message);
  process.exit(1);
}


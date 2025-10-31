#!/usr/bin/env node

const archiver = require('archiver');
const fs = require('fs');
const path = require('path');

const outputPath = path.join(__dirname, '..', 'blinko-extension.zip');
const output = fs.createWriteStream(outputPath);
const archive = archiver('zip', {
  zlib: { level: 9 } // 最高压缩级别
});

// 监听事件
output.on('close', () => {
  console.log(`✓ 打包完成: ${outputPath}`);
  console.log(`  文件大小: ${(archive.pointer() / 1024 / 1024).toFixed(2)} MB`);
  console.log(`  包含文件: ${archive.pointer()} bytes`);
});

archive.on('error', (err) => {
  console.error('❌ 打包失败:', err.message);
  process.exit(1);
});

archive.on('warning', (err) => {
  if (err.code === 'ENOENT') {
    console.warn('⚠️  警告:', err.message);
  } else {
    throw err;
  }
});

// 开始打包
console.log('📦 开始打包扩展...');

archive.pipe(output);

// 添加文件和目录
archive.file('manifest.json', { name: 'manifest.json' });
archive.directory('src/', 'src');
archive.directory('icons/', 'icons');
archive.directory('dist/', 'dist');
archive.directory('_locales/', '_locales');

// 完成打包
archive.finalize();


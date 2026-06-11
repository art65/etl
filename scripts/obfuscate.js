const fs = require('fs');
const path = require('path');

/**
 * JavaScript 混淆和压缩工具
 * 使用 javascript-obfuscator 库对 _worker.js 进行混淆和压缩
 * 生成的文件仍然可正常执行
 */

// 如果未安装，尝试使用 npm install 安装依赖
let obfuscator;
try {
  obfuscator = require('javascript-obfuscator');
} catch (e) {
  console.error('❌ javascript-obfuscator 未安装，请运行: npm install javascript-obfuscator');
  process.exit(1);
}

const args = process.argv.slice(2);
if (args.length < 1) {
  console.error('Usage: node obfuscate.js <input-file> [output-file]');
  process.exit(1);
}

const inputFile = args[0];
const outputFile = args[1] || inputFile.replace('.js', '.min.js');

try {
  console.log(`📖 Reading file: ${inputFile}`);
  const code = fs.readFileSync(inputFile, 'utf8');
  const originalSize = code.length;

  console.log('🔀 Obfuscating and compressing...');
  
  const obfuscated = obfuscator.obfuscate(code, {
    // 混淆配置
    compact: true,              // 紧凑输出（移除换行）
    controlFlowFlattening: false, // 不使用控制流扁平化（会影响性能）
    deadCodeInjection: false,    // 不注入死代码（保持文件大小）
    debugProtection: false,      // 不添加调试保护
    identifierNamesGenerator: 'hexadecimal', // 使用16进制标识符
    log: false,
    renameGlobals: false,        // 不重命名全局变量（保证 Worker API 可用）
    rotateStringArray: true,
    selfDefending: false,
    stringArray: true,           // 字符串数组化
    stringArrayThreshold: 0.75,
    unicodeEscapeSequence: false // 不使用 unicode 转义（保持可读性）
  }).getObfuscatedCode();

  console.log(`💾 Writing to: ${outputFile}`);
  fs.writeFileSync(outputFile, obfuscated, 'utf8');

  const finalSize = fs.statSync(outputFile).size;
  const compression = ((1 - finalSize / originalSize) * 100).toFixed(2);

  console.log(`
✅ 完成！
───────────────────────────
原始大小: ${(originalSize / 1024).toFixed(2)} KB
压缩大小: ${(finalSize / 1024).toFixed(2)} KB
压缩比:   ${compression}%
───────────────────────────
  `);

} catch (error) {
  console.error('❌ 错误:', error.message);
  process.exit(1);
}

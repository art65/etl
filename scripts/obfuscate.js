const fs = require('fs');
const path = require('path');

/**
 * JavaScript 混淆和压缩工具
 * 使用 javascript-obfuscator 库对 _worker.js 进行混淆和压缩
 * 特别优化：处理大量中文变量名的代码
 */

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

// 映射表：记录中文变量名 -> 拉丁字符转换
const chineseVarMap = new Map();
let varCounter = 0;

/**
 * 第一步：将中文变量转换为拉丁字符
 * 处理: const/let/var 声明、函数参数、对象属性、class成员等
 */
function preprocessChineseIdentifiers(code) {
  console.log('🔤 Step 1: Converting Chinese identifiers to Latin characters...');
  
  // 匹配 const/let/var 声明中的中文变量
  code = code.replace(
    /\b(const|let|var)\s+([\u4e00-\u9fff_$][a-zA-Z0-9_$\u4e00-\u9fff]*)/g,
    (match, keyword, varName) => {
      const newName = getOrCreateNewName(varName);
      return `${keyword} ${newName}`;
    }
  );

  // 匹配函数声明中的中文函数名
  code = code.replace(
    /\bfunction\s+([\u4e00-\u9fff_$][a-zA-Z0-9_$\u4e00-\u9fff]*)\s*\(/g,
    (match, funcName) => {
      const newName = getOrCreateNewName(funcName);
      return `function ${newName}(`;
    }
  );

  // 匹配函数参数中的中文变量
  code = code.replace(
    /\([\s\S]*?\)/g,
    (paramsStr) => {
      return paramsStr.replace(
        /([\u4e00-\u9fff_$][a-zA-Z0-9_$\u4e00-\u9fff]*)\s*[,)]/g,
        (match, paramName) => {
          if (/^[\u4e00-\u9fff]/.test(paramName)) {
            const newName = getOrCreateNewName(paramName);
            return match.replace(paramName, newName);
          }
          return match;
        }
      );
    }
  );

  // 匹配对象属性中的中文变量（作为 key 时通常在引号中或 [] 中）
  code = code.replace(
    /[\[\.]?([\u4e00-\u9fff_$][a-zA-Z0-9_$\u4e00-\u9fff]*)\s*[:=]/g,
    (match, propName) => {
      if (/^[\u4e00-\u9fff]/.test(propName)) {
        const newName = getOrCreateNewName(propName);
        return match.replace(propName, newName);
      }
      return match;
    }
  );

  // 替换所有中文变量使用处（关键步骤）
  for (const [chinese, latin] of chineseVarMap.entries()) {
    // 使用单词边界，避免误替换
    const regex = new RegExp(`\\b${escapeRegex(chinese)}\\b`, 'g');
    code = code.replace(regex, latin);
    console.log(`   ✓ ${chinese} → ${latin}`);
  }

  return code;
}

/**
 * 获取或创建新的拉丁字符变量名
 */
function getOrCreateNewName(chineseName) {
  if (!chineseVarMap.has(chineseName)) {
    const newName = `_c${varCounter++}`;
    chineseVarMap.set(chineseName, newName);
  }
  return chineseVarMap.get(chineseName);
}

/**
 * 转义正则特殊字符
 */
function escapeRegex(str) {
  return str.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

try {
  console.log(`📖 Reading file: ${inputFile}`);
  let code = fs.readFileSync(inputFile, 'utf8');
  const originalSize = code.length;

  // 第一步：预处理中文标识符
  code = preprocessChineseIdentifiers(code);

  console.log(`\n🔀 Step 2: Obfuscating and compressing with javascript-obfuscator...\n`);
  
  const obfuscated = obfuscator.obfuscate(code, {
    // 基础混淆选项
    compact: true,
    controlFlowFlattening: false,
    deadCodeInjection: false,
    debugProtection: false,
    
    // 标识符混淆 - 关键选项
    identifierNamesGenerator: 'hexadecimal',
    renameGlobals: false,        // 保持全局变量（Worker API）
    
    // 字符串处理
    stringArray: true,
    stringArrayThreshold: 0.75,
    unicodeEscapeSequence: true, // 启用 Unicode 转义
    
    // 其他选项
    rotateStringArray: true,
    selfDefending: false,
    log: false
  }).getObfuscatedCode();

  console.log(`💾 Writing to: ${outputFile}`);
  fs.writeFileSync(outputFile, obfuscated, 'utf8');

  const finalSize = fs.statSync(outputFile).size;
  const compression = ((1 - finalSize / originalSize) * 100).toFixed(2);

  console.log(`
✅ 完成！
────────────────────────────────
原始大小:        ${(originalSize / 1024).toFixed(2)} KB
压缩大小:        ${(finalSize / 1024).toFixed(2)} KB
压缩比:          ${compression}%
转换变量数:      ${chineseVarMap.size}
────────────────────────────────
  `);

} catch (error) {
  console.error('❌ 错误:', error.message);
  console.error(error.stack);
  process.exit(1);
}

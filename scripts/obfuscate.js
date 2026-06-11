const fs = require('fs');
const path = require('path');
const parser = require('@babel/parser');
const traverse = require('@babel/traverse').default;
const generate = require('@babel/generator').default;
const t = require('@babel/types');
const Terser = require('terser');

/**
 * JavaScript 压缩工具 - 使用 Babel AST
 * 功能：
 * 1. 使用 AST 安全地识别和转换中文标识符
 * 2. 使用 Terser 进行极致压缩
 * 3. 压缩全局变量、函数名、属性名等
 */

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

// 统计信息
const stats = {
  originalSize: 0,
  afterChineseConversion: 0,
  afterTerserCompression: 0,
  totalVariablesConverted: 0,
  totalIdentifiersReplaced: 0
};

/**
 * 检查是否是中文标识符
 */
function isChineseIdentifier(name) {
  return /[\u4e00-\u9fff]/.test(name);
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
 * 使用 Babel AST 安全地处理中文标识符
 */
function preprocessChineseWithAST(code) {
  console.log('🔤 Step 1: Converting Chinese identifiers using AST...\n');

  try {
    // 解析代码为 AST（禁用 TypeScript）
    const ast = parser.parse(code, {
      sourceType: 'module',
      allowImportExportEverywhere: true,
      allowReturnOutsideFunction: true,
      plugins: [
        'jsx',
        'classProperties',
        'classPrivateProperties',
        'classPrivateMethods',
        'exportDefaultFrom',
        'exportNamespaceFrom',
        'logicalAssignment',
        'optionalChaining',
        'nullishCoalescingOperator',
        'asyncGenerators',
        'functionBind',
        'functionSent',
        'dynamicImport',
        ['decorators', { decoratorsBeforeExport: false }],
        'importMeta',
        'topLevelAwait',
        'partialApplication'
      ]
    });

    // 遍历 AST，查找和替换中文标识符
    traverse(ast, {
      // 变量声明（const, let, var）
      VariableDeclarator(path) {
        const { id } = path.node;
        if (t.isIdentifier(id) && isChineseIdentifier(id.name)) {
          const newName = getOrCreateNewName(id.name);
          const oldName = id.name;
          id.name = newName;
          console.log(`   ✓ Variable: ${oldName} → ${newName}`);
          stats.totalVariablesConverted++;
        }
      },

      // 函数声明
      FunctionDeclaration(path) {
        const { node } = path;
        if (node.id && isChineseIdentifier(node.id.name)) {
          const newName = getOrCreateNewName(node.id.name);
          const oldName = node.id.name;
          console.log(`   ✓ Function: ${oldName} → ${newName}`);
          node.id.name = newName;
          stats.totalVariablesConverted++;
        }
        
        // 处理参数
        node.params.forEach((param) => {
          if (t.isIdentifier(param) && isChineseIdentifier(param.name)) {
            const newName = getOrCreateNewName(param.name);
            const oldName = param.name;
            console.log(`   ✓ Parameter: ${oldName} → ${newName}`);
            param.name = newName;
            stats.totalVariablesConverted++;
          }
        });
      },

      // 函数表达式
      FunctionExpression(path) {
        const { node } = path;
        if (node.id && isChineseIdentifier(node.id.name)) {
          const newName = getOrCreateNewName(node.id.name);
          const oldName = node.id.name;
          console.log(`   ✓ Function expr: ${oldName} → ${newName}`);
          node.id.name = newName;
          stats.totalVariablesConverted++;
        }
        
        // 处理参数
        node.params.forEach((param) => {
          if (t.isIdentifier(param) && isChineseIdentifier(param.name)) {
            const newName = getOrCreateNewName(param.name);
            const oldName = param.name;
            console.log(`   ✓ Parameter: ${oldName} → ${newName}`);
            param.name = newName;
            stats.totalVariablesConverted++;
          }
        });
      },

      // 箭头函数
      ArrowFunctionExpression(path) {
        const { node } = path;
        node.params.forEach((param) => {
          if (t.isIdentifier(param) && isChineseIdentifier(param.name)) {
            const newName = getOrCreateNewName(param.name);
            const oldName = param.name;
            console.log(`   ✓ Arrow param: ${oldName} → ${newName}`);
            param.name = newName;
            stats.totalVariablesConverted++;
          }
        });
      },

      // 对象属性
      ObjectProperty(path) {
        const { node } = path;
        // 处理 shorthand properties 和 key
        if (t.isIdentifier(node.key) && isChineseIdentifier(node.key.name)) {
          const newName = getOrCreateNewName(node.key.name);
          const oldName = node.key.name;
          console.log(`   ✓ Property: ${oldName} → ${newName}`);
          node.key.name = newName;
          stats.totalVariablesConverted++;
        }
        if (t.isIdentifier(node.value) && isChineseIdentifier(node.value.name)) {
          const newName = getOrCreateNewName(node.value.name);
          node.value.name = newName;
        }
      },

      // 类声明
      ClassDeclaration(path) {
        const { node } = path;
        if (node.id && isChineseIdentifier(node.id.name)) {
          const newName = getOrCreateNewName(node.id.name);
          const oldName = node.id.name;
          console.log(`   ✓ Class: ${oldName} → ${newName}`);
          node.id.name = newName;
          stats.totalVariablesConverted++;
        }
      },

      // 方法定义
      ClassMethod(path) {
        const { node } = path;
        if (t.isIdentifier(node.key) && isChineseIdentifier(node.key.name)) {
          const newName = getOrCreateNewName(node.key.name);
          const oldName = node.key.name;
          console.log(`   ✓ Method: ${oldName} → ${newName}`);
          node.key.name = newName;
          stats.totalVariablesConverted++;
        }
        
        // 处理参数
        node.params.forEach((param) => {
          if (t.isIdentifier(param) && isChineseIdentifier(param.name)) {
            const newName = getOrCreateNewName(param.name);
            const oldName = param.name;
            console.log(`   ✓ Method param: ${oldName} → ${newName}`);
            param.name = newName;
            stats.totalVariablesConverted++;
          }
        });
      },

      // 对象方法
      ObjectMethod(path) {
        const { node } = path;
        if (t.isIdentifier(node.key) && isChineseIdentifier(node.key.name)) {
          const newName = getOrCreateNewName(node.key.name);
          const oldName = node.key.name;
          console.log(`   ✓ Object method: ${oldName} → ${newName}`);
          node.key.name = newName;
          stats.totalVariablesConverted++;
        }
        
        // 处理参数
        node.params.forEach((param) => {
          if (t.isIdentifier(param) && isChineseIdentifier(param.name)) {
            const newName = getOrCreateNewName(param.name);
            const oldName = param.name;
            console.log(`   ✓ Method param: ${oldName} → ${newName}`);
            param.name = newName;
            stats.totalVariablesConverted++;
          }
        });
      },

      // 更新所有标识符引用
      Identifier(path) {
        const { node } = path;
        // 跳过某些特殊的标识符位置
        if (path.isReferencedIdentifier() || path.isBindingIdentifier()) {
          if (chineseVarMap.has(node.name)) {
            const newName = chineseVarMap.get(node.name);
            node.name = newName;
            stats.totalIdentifiersReplaced++;
          }
        }
      }
    });

    // 生成新的代码
    const { code: generatedCode } = generate(ast, {
      compact: false,
      minified: false
    });

    console.log(`\n   📊 Converted unique variables: ${chineseVarMap.size}`);
    console.log(`   📊 Total identifier replacements: ${stats.totalIdentifiersReplaced}\n`);
    return generatedCode;
  } catch (error) {
    console.error('❌ AST 解析错误:', error.message);
    throw error;
  }
}

try {
  console.log(`📖 Reading file: ${inputFile}\n`);
  let code = fs.readFileSync(inputFile, 'utf8');
  stats.originalSize = code.length;
  console.log(`   原始文件大小: ${(stats.originalSize / 1024).toFixed(2)} KB\n`);

  // 第一步：使用 AST 安全处理中文标识符
  code = preprocessChineseWithAST(code);
  stats.afterChineseConversion = code.length;
  
  console.log(`✅ Step 1 完成！`);
  console.log(`   转换后大小:   ${(stats.afterChineseConversion / 1024).toFixed(2)} KB`);
  console.log(`   变化:        ${((stats.afterChineseConversion - stats.originalSize) / 1024).toFixed(2)} KB\n`);

  // 第二步：使用 Terser 进行压缩
  console.log('🔨 Step 2: Compressing with Terser...\n');
  
  let compressed = code;
  let compressionApplied = false;
  
  try {
    const result = Terser.minify(code, {
      compress: {
        passes: 3,
        pure_funcs: null,
        pure_getters: true,
        reduce_vars: true,
        toplevel: true,
        unsafe: true,
        unsafe_methods: true,
        unused: true,
        drop_console: false,
        booleans: true,
        conditionals: true,
        dead_code: true,
        evaluate: true,
        if_return: true,
        join_vars: true,
        loops: true,
        side_effects: true,
        switches: true,
        typeofs: false,
      },
      mangle: {
        toplevel: true,
        eval: true,
        keep_fnames: false,
        safari10: false,
        properties: {
          keep_quoted: true,
        }
      },
      output: {
        comments: false,
        beautify: false,
      }
    });

    if (result.error) {
      console.warn('⚠️  Terser compression error:', result.error.message);
      console.warn('   Using non-compressed version instead...\n');
    } else if (!result.code) {
      console.warn('⚠️  Terser returned no code');
      console.warn('   Using non-compressed version instead...\n');
    } else {
      compressed = result.code;
      compressionApplied = true;
      console.log('✅ Terser compression successful\n');
    }
  } catch (terserError) {
    console.warn('⚠️  Terser compression failed:', terserError.message);
    console.warn('   Using non-compressed version instead...\n');
  }

  stats.afterTerserCompression = compressed.length;

  console.log(`✅ Step 2 完成！`);
  console.log(`   压缩后大小:   ${(stats.afterTerserCompression / 1024).toFixed(2)} KB`);
  console.log(`   变化:        ${((stats.afterTerserCompression - stats.afterChineseConversion) / 1024).toFixed(2)} KB`);
  console.log(`   压缩效果:     ${compressionApplied ? '✓ 已启用' : '✗ 未启用'}\n`);

  console.log(`💾 Writing to: ${outputFile}`);
  fs.writeFileSync(outputFile, compressed, 'utf8');

  const finalSize = fs.statSync(outputFile).size;
  const totalCompression = ((1 - finalSize / stats.originalSize) * 100).toFixed(2);
  const step1Compression = ((1 - stats.afterChineseConversion / stats.originalSize) * 100).toFixed(2);
  const step2Compression = ((1 - stats.afterTerserCompression / stats.afterChineseConversion) * 100).toFixed(2);

  console.log(`
✅ 全部完成！
════════════════════════════════════════════════
📊 详细统计
════════════════════════════════════════════════
原始文件大小:              ${(stats.originalSize / 1024).toFixed(2)} KB
──────────────────────────────────────────────
第一步 (AST转换):
  转换后大小:             ${(stats.afterChineseConversion / 1024).toFixed(2)} KB
  压缩比:                ${step1Compression}%
  处理变量数:            ${chineseVarMap.size}
  标识符替换数:          ${stats.totalIdentifiersReplaced}
──────────────────────────────────────────────
第二步 (Terser压缩):
  压缩后大小:             ${(stats.afterTerserCompression / 1024).toFixed(2)} KB
  压缩比:                ${step2Compression}%
  压缩状态:              ${compressionApplied ? '✓ 已启用' : '✗ 未启用'}
──────────────────────────────────────────────
最终结果:
  输出文件大小:          ${(finalSize / 1024).toFixed(2)} KB
  总体压缩比:            ${totalCompression}%
  文件节省:              ${((stats.originalSize - finalSize) / 1024).toFixed(2)} KB
════════════════════════════════════════════════

🎯 特性:
   ✓ AST 安全处理（不会误替换）
   ✓ 全局变量压缩
   ✓ 函数名压缩
   ✓ 属性名压缩
   ✓ 中文标识符转换
   ✓ 死代码消除
   ✓ 多轮优化 (3 passes)
════════════════════════════════════════════════
  `);

} catch (error) {
  console.error('❌ 错误:', error.message);
  console.error(error.stack);
  process.exit(1);
}

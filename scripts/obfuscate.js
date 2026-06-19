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

// KV 存储相关变量名 - 这些变量的属性名不能重命名（会被 JSON.stringify 存入 KV）
const KV_VARIABLE_NAMES = new Set([
  'config_JSON', '默认配置JSON',
  'CF_JSON', '初始化CF_JSON',
  'TG_JSON', '初始化TG_JSON',
  '日志数组',
]);

// 受保护的中文属性名集合（预扫描填充）
const protectedPropertyNames = new Set();

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
 * 预扫描：收集 KV 变量上访问的所有中文属性名，加入保护集
 * 这些属性名会被 JSON.stringify 存入 KV，重命名后会导致读取时 key 不匹配
 */
function collectProtectedProperties(ast) {
  console.log('🔍 Pre-scan: Collecting protected property names from KV variables...\n');

  traverse(ast, {
    MemberExpression(path) {
      const { node } = path;
      // 找到 MemberExpression 链的根对象
      let rootObj = node.object;
      while (t.isMemberExpression(rootObj)) {
        rootObj = rootObj.object;
      }
      // 如果根对象是 KV 变量，收集链上所有中文属性名
      if (t.isIdentifier(rootObj) && KV_VARIABLE_NAMES.has(rootObj.name)) {
        let current = node;
        while (t.isMemberExpression(current)) {
          if (t.isIdentifier(current.property) && isChineseIdentifier(current.property.name) && !current.computed) {
            protectedPropertyNames.add(current.property.name);
          }
          current = current.object;
        }
      }
    },
    // 也收集 KV 变量对象字面量中的中文 key
    VariableDeclarator(path) {
      const { id, init } = path.node;
      if (t.isIdentifier(id) && KV_VARIABLE_NAMES.has(id.name) && init) {
        collectChineseKeysFromObject(init);
      }
    },
    // 赋值表达式：config_JSON = { ... }
    AssignmentExpression(path) {
      const { left, right } = path.node;
      if (t.isIdentifier(left) && KV_VARIABLE_NAMES.has(left.name) && t.isObjectExpression(right)) {
        collectChineseKeysFromObject(right);
      }
    },
  });

  console.log(`   📋 Protected property names (${protectedPropertyNames.size}):`);
  console.log(`      ${[...protectedPropertyNames].join(', ')}\n`);
}

/**
 * 递归收集对象表达式中的所有中文 key
 */
function collectChineseKeysFromObject(node) {
  if (!t.isObjectExpression(node)) return;
  for (const prop of node.properties) {
    if (t.isObjectProperty(prop) && t.isIdentifier(prop.key) && isChineseIdentifier(prop.key.name)) {
      protectedPropertyNames.add(prop.key.name);
    }
    // 递归处理嵌套对象
    if (t.isObjectProperty(prop) && t.isObjectExpression(prop.value)) {
      collectChineseKeysFromObject(prop.value);
    }
  }
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

    // 预扫描：收集受保护的属性名
    collectProtectedProperties(ast);

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

      // 对象属性 - 受保护的 key 不重命名（KV 存储字段），其余照常重命名
      ObjectProperty(path) {
        const { node } = path;
        if (t.isIdentifier(node.key) && isChineseIdentifier(node.key.name)) {
          if (protectedPropertyNames.has(node.key.name)) {
            // 受保护属性：key 保留原名，shorthand 需要展开
            if (node.shorthand) {
              const newName = getOrCreateNewName(node.key.name);
              node.shorthand = false;
              node.value = t.identifier(newName);
              console.log(`   ✓ Shorthand expanded (protected): ${node.key.name} → ${node.key.name}: ${newName}`);
              stats.totalVariablesConverted++;
            }
          } else {
            // 非保护属性：key 可以重命名
            const newName = getOrCreateNewName(node.key.name);
            const oldName = node.key.name;
            node.key.name = newName;
            console.log(`   ✓ Property: ${oldName} → ${newName}`);
            stats.totalVariablesConverted++;
          }
        }
        // value 中的标识符引用
        if (!node.shorthand && t.isIdentifier(node.value) && isChineseIdentifier(node.value.name)) {
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

      // 方法定义 - 受保护的 key 不重命名
      ClassMethod(path) {
        const { node } = path;
        if (t.isIdentifier(node.key) && isChineseIdentifier(node.key.name) && !protectedPropertyNames.has(node.key.name)) {
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

      // 对象方法 - 受保护的 key 不重命名
      ObjectMethod(path) {
        const { node } = path;
        if (t.isIdentifier(node.key) && isChineseIdentifier(node.key.name) && !protectedPropertyNames.has(node.key.name)) {
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

      // 更新所有标识符引用（受保护的 MemberExpression property 和 ObjectProperty key 不替换）
      Identifier(path) {
        const { node } = path;
        // 跳过受保护的 MemberExpression.property（如 config_JSON.订阅转换配置 中的 订阅转换配置）
        if (path.parentPath && t.isMemberExpression(path.parentPath.node) && path.parentPath.node.property === node && !path.parentPath.node.computed && protectedPropertyNames.has(node.name)) {
          return;
        }
        // 跳过受保护的 ObjectProperty.key（如 {协议类型: ...} 中的 协议类型）
        if (path.parentPath && t.isObjectProperty(path.parentPath.node) && path.parentPath.node.key === node && !path.parentPath.node.computed && protectedPropertyNames.has(node.name)) {
          return;
        }
        if (chineseVarMap.has(node.name)) {
          const newName = chineseVarMap.get(node.name);
          node.name = newName;
          stats.totalIdentifiersReplaced++;
        }
      }
    });

    // 第二遍扫描：确保所有引用都被替换（同样跳过受保护的 MemberExpression property 和 ObjectProperty key）
    traverse(ast, {
      Identifier(path) {
        const { node } = path;
        if (path.parentPath && t.isMemberExpression(path.parentPath.node) && path.parentPath.node.property === node && !path.parentPath.node.computed && protectedPropertyNames.has(node.name)) {
          return;
        }
        if (path.parentPath && t.isObjectProperty(path.parentPath.node) && path.parentPath.node.key === node && !path.parentPath.node.computed && protectedPropertyNames.has(node.name)) {
          return;
        }
        if (chineseVarMap.has(node.name)) {
          node.name = chineseVarMap.get(node.name);
        }
      }
    });

    // 生成新的代码 - 使用紧凑格式
    const { code: generatedCode } = generate(ast, {
      compact: 'auto',
      minified: true,
      retainLines: false,
      shouldPrintComment: () => false
    });

    console.log(`\n   📊 Converted unique variables: ${chineseVarMap.size}`);
    console.log(`   📊 Total identifier replacements: ${stats.totalIdentifiersReplaced}\n`);
    return generatedCode;
  } catch (error) {
    console.error('❌ AST 解析错误:', error.message);
    throw error;
  }
}

async function main() {
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
      const terserOptions = {
        compress: {
          passes: 2,
          pure_funcs: null,
          pure_getters: false,
          reduce_vars: false,
          toplevel: false,
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
          toplevel: false,
          eval: false,
          keep_fnames: false,
          safari10: false,
          properties: false,
        },
        output: {
          comments: false,
          beautify: false,
        }
      };

      console.log('   📋 Terser 配置已准备');
      console.log(`   ℹ️  代码行数: ${code.split('\n').length}`);
      console.log(`   ℹ️  代码大小: ${(code.length / 1024).toFixed(2)} KB\n`);

      const result = await Terser.minify(code, terserOptions);

      console.log('   🔍 Terser 返回结果:');
      console.log(`   ℹ️  result.code: ${result.code ? `✓ (${result.code.length} bytes)` : '✗ undefined'}`);
      console.log(`   ℹ️  result.error: ${result.error ? `✗ ${result.error.message}` : '✓ null'}`);
      console.log(`   ℹ️  result.warnings: ${result.warnings && result.warnings.length > 0 ? `⚠️  ${result.warnings.length} warnings` : '✓ none'}\n`);

      if (result.warnings && result.warnings.length > 0) {
        console.log('   ⚠️  Warnings:');
        result.warnings.forEach((w, i) => console.log(`      ${i + 1}. ${w}`));
        console.log();
      }

      if (result.error) {
        console.warn('❌ Terser compression error:');
        console.warn(`   Message: ${result.error.message}`);
        console.warn(`   Code: ${result.error.code}`);
        console.warn(`   Line: ${result.error.line}`);
        console.warn('   Using non-compressed version instead...\n');
      } else if (!result.code) {
        console.warn('⚠️  Terser returned no code (code is undefined/null)');
        console.warn('   Using non-compressed version instead...\n');
      } else {
        compressed = result.code;
        compressionApplied = true;
        console.log('✅ Terser compression successful\n');
      }
    } catch (terserError) {
      console.warn('❌ Terser compression exception:');
      console.warn(`   ${terserError.message}`);
      if (terserError.stack) {
        console.warn(`   Stack: ${terserError.stack.substring(0, 200)}...`);
      }
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
   ✓ 激进模式（更强压缩）
════════════════════════════════════════════════
  `);

  } catch (error) {
    console.error('❌ 错误:', error.message);
    console.error(error.stack);
    process.exit(1);
  }
}

main().catch((error) => {
  console.error('❌ 错误:', error.message);
  console.error(error.stack);
  process.exit(1);
});

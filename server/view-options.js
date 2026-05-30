function normalizeIdentifier(value) {
  return String(value || "")
    .trim()
    .replace(/^\[|\]$/g, "")
    .replace(/^"|"$/g, "")
    .toLowerCase();
}

function decodeSqlStringLiteral(value) {
  return String(value || "").replace(/''/g, "'").trim();
}

function dedupe(values) {
  return values.filter((value, index) => value && values.indexOf(value) === index);
}

function dedupeCaseBlocks(blocks) {
  const seen = new Set();
  return blocks.filter((block) => {
    const key = `${normalizeIdentifier(block.alias)}::${block.expression}`;
    if (!block.alias || seen.has(key)) {
      return false;
    }
    seen.add(key);
    return true;
  });
}

function extractCaseBlocks(definition) {
  const patterns = [
    /\bCASE\b[\s\S]*?\bEND\b\s+(?:AS\s+)?(?:\[([^\]]+)\]|"([^"]+)"|([A-Za-z_\u4e00-\u9fa5][\w$#@\u4e00-\u9fa5]*))/gi,
    /(?:\[([^\]]+)\]|"([^"]+)"|([A-Za-z_\u4e00-\u9fa5][\w$#@\u4e00-\u9fa5]*))\s*=\s*\b(CASE\b[\s\S]*?\bEND\b)/gi,
  ];

  const blocks = [];

  for (const pattern of patterns) {
    for (const match of definition.matchAll(pattern)) {
      if (pattern === patterns[0]) {
        blocks.push({
          alias: match[1] || match[2] || match[3] || "",
          expression: match[0] || "",
        });
        continue;
      }

      blocks.push({
        alias: match[1] || match[2] || match[3] || "",
        expression: match[4] || "",
      });
    }
  }

  return dedupeCaseBlocks(blocks);
}

function extractLiteralOptions(expression) {
  const options = [];
  const matches = expression.matchAll(/\b(?:THEN|ELSE)\s+N?'((?:''|[^'])*)'/gi);
  for (const match of matches) {
    const value = decodeSqlStringLiteral(match[1]);
    if (value) {
      options.push(value);
    }
  }
  return dedupe(options);
}

function extractSelectOptionsFromViewDefinition(definition, fieldName) {
  if (!definition || !fieldName) {
    return [];
  }

  const targetField = normalizeIdentifier(fieldName);
  const caseBlock = extractCaseBlocks(String(definition)).find((item) => normalizeIdentifier(item.alias) === targetField);
  if (!caseBlock) {
    return [];
  }

  return extractLiteralOptions(caseBlock.expression);
}

function extractSelectOptionsMap(definition, fieldNames) {
  return fieldNames.reduce((result, fieldName) => {
    result[fieldName] = extractSelectOptionsFromViewDefinition(definition, fieldName);
    return result;
  }, {});
}

module.exports = {
  extractSelectOptionsFromViewDefinition,
  extractSelectOptionsMap,
};

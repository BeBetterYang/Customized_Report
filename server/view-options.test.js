const test = require("node:test");
const assert = require("node:assert/strict");

const { extractSelectOptionsFromViewDefinition } = require("./view-options");

test("extracts THEN literals for a CASE expression aliased to the target field", () => {
  const definition = `
    CREATE VIEW [dbo].[v_demo]
    AS
    SELECT
      CASE
        WHEN status = 0 THEN N'未开始'
        WHEN status = 1 THEN N'进行中'
        WHEN status = 2 THEN N'已完成'
        ELSE N'未知'
      END AS [status_label],
      customer_name
    FROM dbo.demo
  `;

  assert.deepEqual(extractSelectOptionsFromViewDefinition(definition, "status_label"), ["未开始", "进行中", "已完成", "未知"]);
});

test("deduplicates options and ignores CASE blocks for other fields", () => {
  const definition = `
    CREATE VIEW [dbo].[v_demo]
    AS
    SELECT
      CASE WHEN enabled = 1 THEN '启用' ELSE '停用' END AS enabled_text,
      CASE
        WHEN type = 'A' THEN '零售'
        WHEN type = 'B' THEN '批发'
        WHEN type = 'C' THEN '批发'
      END AS type_text
    FROM dbo.demo
  `;

  assert.deepEqual(extractSelectOptionsFromViewDefinition(definition, "type_text"), ["零售", "批发"]);
  assert.deepEqual(extractSelectOptionsFromViewDefinition(definition, "missing_field"), []);
});

test("extracts options when the alias is written without AS", () => {
  const definition = `
    CREATE VIEW [dbo].[v_demo]
    AS
    SELECT
      CASE
        WHEN audit_status = 0 THEN N'待审核'
        WHEN audit_status = 1 THEN N'已审核'
        ELSE N'驳回'
      END [审核状态]
    FROM dbo.demo
  `;

  assert.deepEqual(extractSelectOptionsFromViewDefinition(definition, "审核状态"), ["待审核", "已审核", "驳回"]);
});

test("extracts options when the alias is written in assignment form", () => {
  const definition = `
    CREATE VIEW [dbo].[v_demo]
    AS
    SELECT
      [单据状态] = CASE
        WHEN bill_status = 'A' THEN N'新建'
        WHEN bill_status = 'B' THEN N'已提交'
        ELSE N'已关闭'
      END
    FROM dbo.demo
  `;

  assert.deepEqual(extractSelectOptionsFromViewDefinition(definition, "单据状态"), ["新建", "已提交", "已关闭"]);
});

test("extracts options from simple CASE expressions", () => {
  const definition = `
    CREATE VIEW [dbo].[v_demo]
    AS
    SELECT
      CASE ndxsale.Draft
        WHEN 2 THEN '已审核'
        WHEN 4 THEN '未审核'
        ELSE '草稿'
      END AS DraftStatus
    FROM dbo.demo ndxsale
  `;

  assert.deepEqual(extractSelectOptionsFromViewDefinition(definition, "DraftStatus"), ["已审核", "未审核", "草稿"]);
});

const fs = require("fs/promises");
const path = require("path");
const cors = require("cors");
const express = require("express");
const sql = require("mssql");
const { extractSelectOptionsMap } = require("./view-options");
const { deserializeStateValue, serializeStateValue } = require("./state-security.cjs");

const app = express();
const defaultPort = Number(process.env.API_PORT || 3001);
const defaultHost = process.env.API_HOST || "127.0.0.1";
let webAppRegistered = false;
let appStateDir = path.resolve(process.cwd(), ".app-state");

app.use(cors());
app.use(express.json({ limit: "1mb" }));

function ensureSafeStateKey(key) {
  if (!key || !/^[a-zA-Z0-9_-]+$/.test(String(key))) {
    const error = new Error("配置键不合法。");
    error.status = 400;
    throw error;
  }
  return String(key);
}

function resolveStateFilePath(key) {
  return path.join(appStateDir, `${ensureSafeStateKey(key)}.json`);
}

async function readStoredState(key, fallback = null) {
  try {
    const raw = await fs.readFile(resolveStateFilePath(key), "utf8");
    return deserializeStateValue(key, JSON.parse(raw));
  } catch (error) {
    if (error && typeof error === "object" && error.code === "ENOENT") {
      return fallback;
    }
    throw error;
  }
}

async function writeStoredState(key, value) {
  await fs.mkdir(appStateDir, { recursive: true });
  await fs.writeFile(resolveStateFilePath(key), JSON.stringify(serializeStateValue(key, value), null, 2), "utf8");
}

const tdsVersionBySqlServer = {
  "2008R2": "7_3_A",
  "2012": "7_4",
  "2016": "7_4",
  "2019": "7_4",
  "2022": "7_4",
};

function requireDatabaseConfig(database) {
  if (!database || !database.host || !database.database || !database.username) {
    const error = new Error("缺少数据库连接参数，请填写主机、数据库名、账号和密码。");
    error.status = 400;
    throw error;
  }
}

function toSqlConfig(database) {
  requireDatabaseConfig(database);
  const portNumber = Number(database.port || 1433);
  const options = {
    encrypt: Boolean(database.encrypt),
    trustServerCertificate: database.trustServerCertificate !== false,
    enableArithAbort: true,
    tdsVersion: tdsVersionBySqlServer[database.version] || "7_4",
  };

  if (database.instanceName) {
    options.instanceName = database.instanceName;
  }

  return {
    server: database.host,
    port: Number.isFinite(portNumber) ? portNumber : 1433,
    database: database.database,
    user: database.username,
    password: database.password || "",
    connectionTimeout: 15000,
    requestTimeout: 60000,
    pool: {
      max: 5,
      min: 0,
      idleTimeoutMillis: 30000,
    },
    options,
  };
}

async function withPool(database, handler) {
  const pool = new sql.ConnectionPool(toSqlConfig(database));
  try {
    await pool.connect();
    return await handler(pool);
  } finally {
    await pool.close();
  }
}

function normalizeIdentifier(value, label) {
  if (!value || !/^[\w\u4e00-\u9fa5$#@]+$/.test(value)) {
    const error = new Error(`${label}不合法。`);
    error.status = 400;
    throw error;
  }
  return value;
}

function quoteIdentifier(value, label) {
  if (!value || String(value).length > 128) {
    const error = new Error(`${label}不合法。`);
    error.status = 400;
    throw error;
  }
  return `[${String(value).replace(/]/g, "]]")}]`;
}

function stripAt(name) {
  return String(name || "").replace(/^@/, "");
}

function getProcedureFullName(procedure) {
  const schema = normalizeIdentifier(procedure?.schema, "存储过程架构名");
  const name = normalizeIdentifier(procedure?.name, "存储过程名称");
  return `${schema}.${name}`;
}

function getViewFullName(view) {
  const schema = quoteIdentifier(view?.schema, "视图架构名");
  const name = quoteIdentifier(view?.name, "视图名称");
  return `${schema}.${name}`;
}

function getSqlTypeText(param) {
  const typeName = String(param.typeName || param.systemTypeName || "").toLowerCase();
  const precision = Number(param.precision || 0);
  const scale = Number(param.scale || 0);
  const maxLength = Number(param.maxLength || 0);

  if (["nvarchar", "nchar"].includes(typeName)) {
    return `${typeName}(${maxLength === -1 ? "max" : Math.max(1, Math.floor(maxLength / 2))})`;
  }
  if (["varchar", "char", "varbinary", "binary"].includes(typeName)) {
    return `${typeName}(${maxLength === -1 ? "max" : Math.max(1, maxLength)})`;
  }
  if (["decimal", "numeric"].includes(typeName)) {
    return `${typeName}(${precision || 18},${scale || 0})`;
  }
  if (typeName) return typeName;
  return "nvarchar(max)";
}

function inferControl(typeText) {
  const typeName = typeText.toLowerCase();
  if (typeName.includes("date") || typeName.includes("time")) return "date";
  if (
    ["int", "bigint", "smallint", "tinyint", "decimal", "numeric", "money", "smallmoney", "float", "real"].some((item) =>
      typeName.includes(item),
    )
  ) {
    return "number";
  }
  if (typeName.includes("bit")) return "select";
  return "text";
}

function inferColumnType(sqlType, sampleValue) {
  const text = String(sqlType || "").toLowerCase();
  if (text.includes("money")) return "currency";
  if (text.includes("date") || text.includes("time")) return "date";
  if (["int", "bigint", "smallint", "tinyint", "decimal", "numeric", "float", "real"].some((item) => text.includes(item))) {
    return "number";
  }
  if (typeof sampleValue === "number") return "number";
  return "string";
}

function toColumn(field, sqlType, sampleValue, index) {
  return {
    field,
    label: field,
    sqlType: sqlType || "",
    type: inferColumnType(sqlType, sampleValue),
    visible: true,
    width: index === 0 ? 160 : 130,
  };
}

function toFilterField(field, sqlType, isNullable, optionValues = []) {
  return {
    name: field,
    sqlType,
    required: false,
    control: inferControl(sqlType),
    nullable: Boolean(isNullable),
    optionValues,
  };
}

function getMssqlType(typeText) {
  const normalized = String(typeText || "").toLowerCase();
  const match = normalized.match(/\(([^)]+)\)/);
  const args = match ? match[1].split(",").map((item) => item.trim()) : [];
  const lengthArg = args[0] === "max" ? sql.MAX : Number(args[0] || 0);
  const precision = Number(args[0] || 18);
  const scale = Number(args[1] || 0);

  if (normalized.startsWith("bigint")) return sql.BigInt;
  if (normalized.startsWith("int")) return sql.Int;
  if (normalized.startsWith("smallint")) return sql.SmallInt;
  if (normalized.startsWith("tinyint")) return sql.TinyInt;
  if (normalized.startsWith("bit")) return sql.Bit;
  if (normalized.startsWith("decimal") || normalized.startsWith("numeric")) return sql.Decimal(precision || 18, scale || 0);
  if (normalized.startsWith("money")) return sql.Money;
  if (normalized.startsWith("smallmoney")) return sql.SmallMoney;
  if (normalized.startsWith("float")) return sql.Float;
  if (normalized.startsWith("real")) return sql.Real;
  if (normalized.startsWith("date") && !normalized.startsWith("datetime")) return sql.Date;
  if (normalized.startsWith("datetime2")) return sql.DateTime2;
  if (normalized.startsWith("datetimeoffset")) return sql.DateTimeOffset;
  if (normalized.startsWith("smalldatetime")) return sql.SmallDateTime;
  if (normalized.startsWith("datetime")) return sql.DateTime;
  if (normalized.startsWith("time")) return sql.Time;
  if (normalized.startsWith("uniqueidentifier")) return sql.UniqueIdentifier;
  if (normalized.startsWith("varbinary")) return sql.VarBinary(lengthArg || sql.MAX);
  if (normalized.startsWith("binary")) return sql.Binary(lengthArg || sql.MAX);
  if (normalized.startsWith("varchar")) return sql.VarChar(lengthArg || sql.MAX);
  if (normalized.startsWith("char")) return sql.Char(lengthArg || sql.MAX);
  if (normalized.startsWith("nchar")) return sql.NChar(lengthArg || sql.MAX);
  return sql.NVarChar(lengthArg || sql.MAX);
}

function getDateMssqlType(typeText) {
  const normalized = String(typeText || "").toLowerCase();
  if (normalized.startsWith("date") && !normalized.startsWith("datetime")) return sql.Date;
  if (normalized.startsWith("datetime2")) return sql.DateTime2;
  if (normalized.startsWith("datetimeoffset")) return sql.DateTimeOffset;
  if (normalized.startsWith("smalldatetime")) return sql.SmallDateTime;
  if (normalized.startsWith("datetime")) return sql.DateTime;
  return sql.DateTime;
}

function coerceDateValue(value) {
  if (value === "" || value === undefined) return undefined;
  if (value === null) return null;
  const dateValue = new Date(value);
  return Number.isNaN(dateValue.getTime()) ? null : dateValue;
}

function coerceValue(value, typeText) {
  if (value === "" || value === undefined) return undefined;
  if (value === null) return null;

  const normalized = String(typeText || "").toLowerCase();
  if (normalized.includes("bit")) {
    if (value === true || value === "true" || value === "1" || value === 1 || value === "是") return true;
    if (value === false || value === "false" || value === "0" || value === 0 || value === "否") return false;
    return null;
  }
  if (
    ["int", "bigint", "smallint", "tinyint", "decimal", "numeric", "money", "smallmoney", "float", "real"].some((item) =>
      normalized.includes(item),
    )
  ) {
    const numberValue = Number(value);
    return Number.isFinite(numberValue) ? numberValue : null;
  }
  if (normalized.includes("date") || normalized.includes("time")) {
    return value ? new Date(value) : null;
  }
  return value;
}

async function getProcedureParams(pool, procedure) {
  const fullName = getProcedureFullName(procedure);
  const result = await pool
    .request()
    .input("fullName", sql.NVarChar(260), fullName)
    .query(`
      SELECT
        p.name,
        TYPE_NAME(p.user_type_id) AS typeName,
        p.max_length AS maxLength,
        p.precision,
        p.scale,
        p.is_output AS isOutput,
        p.has_default_value AS hasDefaultValue
      FROM sys.parameters p
      WHERE p.object_id = OBJECT_ID(@fullName)
      ORDER BY p.parameter_id
    `);

  return result.recordset.map((item) => {
    const sqlType = getSqlTypeText(item);
    return {
      name: item.name,
      sqlType,
      required: !item.hasDefaultValue && !item.isOutput,
      control: inferControl(sqlType),
      isOutput: Boolean(item.isOutput),
      hasDefaultValue: Boolean(item.hasDefaultValue),
    };
  });
}

async function describeColumns(pool, procedure) {
  const fullName = getProcedureFullName(procedure);
  try {
    const result = await pool
      .request()
      .input("fullName", sql.NVarChar(260), fullName)
      .query(`
        SELECT
          name,
          system_type_name AS sqlType,
          column_ordinal AS columnOrdinal
        FROM sys.dm_exec_describe_first_result_set_for_object(OBJECT_ID(@fullName), NULL)
        WHERE is_hidden = 0
          AND error_number IS NULL
          AND name IS NOT NULL
        ORDER BY column_ordinal
      `);

    return {
      columns: result.recordset.map((item, index) => toColumn(item.name, item.sqlType, undefined, index)),
      warning: "",
    };
  } catch (error) {
    return {
      columns: [],
      warning: "当前数据库版本或权限不支持静态分析结果列，首次查询后会根据返回数据生成字段。",
    };
  }
}

async function getViewColumns(pool, view) {
  const result = await pool
    .request()
    .input("schema", sql.NVarChar(128), view?.schema)
    .input("name", sql.NVarChar(128), view?.name)
    .query(`
      SELECT
        c.name,
        TYPE_NAME(c.user_type_id) AS typeName,
        c.max_length AS maxLength,
        c.precision,
        c.scale,
        c.is_nullable AS isNullable,
        c.column_id AS columnId,
        OBJECT_DEFINITION(v.object_id) AS definition
      FROM sys.views v
      INNER JOIN sys.schemas s ON s.schema_id = v.schema_id
      INNER JOIN sys.columns c ON c.object_id = v.object_id
      WHERE s.name = @schema
        AND v.name = @name
      ORDER BY c.column_id
    `);

  if (result.recordset.length === 0) {
    const error = new Error("没有找到该视图，或当前账号没有读取视图字段的权限。");
    error.status = 404;
    throw error;
  }

  const definition = result.recordset[0]?.definition || "";
  const optionValuesMap = extractSelectOptionsMap(
    definition,
    result.recordset.map((item) => item.name),
  );

  const columns = result.recordset.map((item, index) => {
    const sqlType = getSqlTypeText(item);
    return toColumn(item.name, sqlType, undefined, index);
  });

  return {
    columns,
    filters: result.recordset.map((item) => {
      const sqlType = getSqlTypeText(item);
      return toFilterField(item.name, sqlType, item.isNullable, optionValuesMap[item.name] || []);
    }),
  };
}

app.get("/api/health", (_request, response) => {
  response.json({ ok: true });
});

app.get("/api/state/:key", async (request, response, next) => {
  try {
    const value = await readStoredState(request.params.key, null);
    response.json({ ok: true, value });
  } catch (error) {
    next(error);
  }
});

app.post("/api/state/:key", async (request, response, next) => {
  try {
    await writeStoredState(request.params.key, request.body?.value ?? null);
    response.json({ ok: true });
  } catch (error) {
    next(error);
  }
});

app.post("/api/views/list", async (request, response, next) => {
  try {
    const views = await withPool(request.body.database, async (pool) => {
      const result = await pool.request().query(`
        SELECT
          s.name AS schemaName,
          v.name AS viewName,
          CAST(ep.value AS nvarchar(4000)) AS description,
          COUNT(c.column_id) AS columnCount,
          v.create_date AS createDate,
          v.modify_date AS modifyDate
        FROM sys.views v
        INNER JOIN sys.schemas s ON s.schema_id = v.schema_id
        LEFT JOIN sys.columns c ON c.object_id = v.object_id
        LEFT JOIN sys.extended_properties ep
          ON ep.major_id = v.object_id
          AND ep.minor_id = 0
          AND ep.name = 'MS_Description'
        WHERE v.is_ms_shipped = 0
        GROUP BY s.name, v.name, CAST(ep.value AS nvarchar(4000)), v.create_date, v.modify_date
        ORDER BY s.name, v.name
      `);

      return result.recordset.map((item) => ({
        schema: item.schemaName,
        name: item.viewName,
        description: item.description || "无说明",
        columnCount: Number(item.columnCount || 0),
        columns: [],
        filters: [],
        createDate: item.createDate,
        modifyDate: item.modifyDate,
      }));
    });
    response.json({ views });
  } catch (error) {
    next(error);
  }
});

app.post("/api/views/metadata", async (request, response, next) => {
  try {
    const { database, view } = request.body;
    const metadata = await withPool(database, async (pool) => getViewColumns(pool, view));
    response.json(metadata);
  } catch (error) {
    next(error);
  }
});

app.post("/api/views/query", async (request, response, next) => {
  try {
    const { database, view, filters = [], maxRows = 10000 } = request.body;
    const fullName = getViewFullName(view);
    const safeMaxRows = Math.max(1, Math.min(Number(maxRows) || 10000, 50000));

    const payload = await withPool(database, async (pool) => {
      const queryRequest = pool.request();
      const conditions = [];

      filters.forEach((filter, index) => {
        const rawValue = filter.value;
        if (rawValue === "" || rawValue === undefined || rawValue === null) return;

        const field = quoteIdentifier(filter.field || filter.paramName || filter.name, "筛选字段名");
        const inputName = `p${index}`;
        const typeText = filter.sqlType || "";
        const control = filter.control || inferControl(typeText);

        if (control === "date" && typeof rawValue === "object") {
          const startValue = rawValue.start;
          const endValue = rawValue.end;
          const dateType = getDateMssqlType(typeText);
          if (startValue !== "" && startValue !== undefined && startValue !== null) {
            const startInputName = `${inputName}_start`;
            queryRequest.input(startInputName, dateType, coerceDateValue(startValue) ?? null);
            conditions.push(`${field} >= @${startInputName}`);
          }
          if (endValue !== "" && endValue !== undefined && endValue !== null) {
            const endInputName = `${inputName}_end`;
            queryRequest.input(endInputName, dateType, coerceDateValue(endValue) ?? null);
            conditions.push(`${field} < DATEADD(day, 1, @${endInputName})`);
          }
          return;
        }

        if (control === "text") {
          queryRequest.input(inputName, sql.NVarChar(sql.MAX), `%${String(rawValue)}%`);
          conditions.push(`CONVERT(nvarchar(max), ${field}) LIKE @${inputName}`);
          return;
        }

        if (control === "date") {
          queryRequest.input(inputName, getDateMssqlType(typeText), coerceDateValue(rawValue) ?? null);
          conditions.push(`${field} >= @${inputName} AND ${field} < DATEADD(day, 1, @${inputName})`);
          return;
        }

        queryRequest.input(inputName, getMssqlType(typeText), coerceValue(rawValue, typeText) ?? null);
        conditions.push(`${field} = @${inputName}`);
      });

      const whereClause = conditions.length ? ` WHERE ${conditions.join(" AND ")}` : "";
      const result = await queryRequest.query(`SELECT TOP (${safeMaxRows}) * FROM ${fullName}${whereClause}`);
      const rows = result.recordset || [];
      const metadataColumns = Object.entries(result.recordset?.columns || {}).map(([field, meta], index) =>
        toColumn(field, meta.type?.declaration || meta.type?.name || "", rows[0]?.[field], index),
      );
      const inferredColumns =
        metadataColumns.length > 0
          ? metadataColumns
          : Object.keys(rows[0] || {}).map((field, index) => toColumn(field, "", rows[0]?.[field], index));

      return {
        rows,
        columns: inferredColumns,
        maxRows: safeMaxRows,
      };
    });

    response.json(payload);
  } catch (error) {
    next(error);
  }
});

app.post("/api/databases/test", async (request, response, next) => {
  try {
    const result = await withPool(request.body.database, async (pool) => {
      const probe = await pool.request().query("SELECT DB_NAME() AS databaseName, @@VERSION AS versionText");
      return probe.recordset[0];
    });
    response.json({
      ok: true,
      message: `连接成功：${result.databaseName}`,
      serverVersion: result.versionText,
    });
  } catch (error) {
    next(error);
  }
});

app.post("/api/procedures/list", async (request, response, next) => {
  try {
    const procedures = await withPool(request.body.database, async (pool) => {
      const result = await pool.request().query(`
        SELECT
          s.name AS schemaName,
          p.name AS procedureName,
          CAST(ep.value AS nvarchar(4000)) AS description,
          p.create_date AS createDate,
          p.modify_date AS modifyDate
        FROM sys.procedures p
        INNER JOIN sys.schemas s ON s.schema_id = p.schema_id
        LEFT JOIN sys.extended_properties ep
          ON ep.major_id = p.object_id
          AND ep.minor_id = 0
          AND ep.name = 'MS_Description'
        WHERE p.is_ms_shipped = 0
        ORDER BY s.name, p.name
      `);

      return result.recordset.map((item) => ({
        schema: item.schemaName,
        name: item.procedureName,
        description: item.description || "无说明",
        params: [],
        columns: [],
        createDate: item.createDate,
        modifyDate: item.modifyDate,
      }));
    });
    response.json({ procedures });
  } catch (error) {
    next(error);
  }
});

app.post("/api/procedures/metadata", async (request, response, next) => {
  try {
    const { database, procedure } = request.body;
    const metadata = await withPool(database, async (pool) => {
      const [params, columnInfo] = await Promise.all([getProcedureParams(pool, procedure), describeColumns(pool, procedure)]);
      return { params, ...columnInfo };
    });
    response.json(metadata);
  } catch (error) {
    next(error);
  }
});

app.post("/api/procedures/execute", async (request, response, next) => {
  try {
    const { database, procedure, filters = [] } = request.body;
    const fullName = getProcedureFullName(procedure);

    const payload = await withPool(database, async (pool) => {
      const requestWithInputs = pool.request();

      for (const filter of filters) {
        const value = coerceValue(filter.value, filter.sqlType);
        if (value === undefined && !filter.required) continue;
        requestWithInputs.input(stripAt(filter.paramName), getMssqlType(filter.sqlType), value ?? null);
      }

      const result = await requestWithInputs.execute(fullName);
      const rows = result.recordset || [];
      const metadataColumns = Object.entries(result.recordset?.columns || {}).map(([field, meta], index) =>
        toColumn(field, meta.type?.declaration || meta.type?.name || "", rows[0]?.[field], index),
      );
      const inferredColumns =
        metadataColumns.length > 0
          ? metadataColumns
          : Object.keys(rows[0] || {}).map((field, index) => toColumn(field, "", rows[0]?.[field], index));

      return {
        rows,
        columns: inferredColumns,
        rowsAffected: result.rowsAffected || [],
        returnValue: result.returnValue,
      };
    });

    response.json(payload);
  } catch (error) {
    next(error);
  }
});

function resolveWebDistPath(explicitPath) {
  const candidate = explicitPath || process.env.WEB_DIST_PATH;
  if (!candidate) return null;
  return path.resolve(candidate);
}

function registerWebAppRoutes(webDistPath) {
  const resolvedPath = resolveWebDistPath(webDistPath);
  if (!resolvedPath || webAppRegistered) return;

  app.use(express.static(resolvedPath));
  app.get("/{*appPath}", (request, response, next) => {
    if (request.path.startsWith("/api/")) {
      next();
      return;
    }
    response.sendFile(path.join(resolvedPath, "index.html"));
  });
  webAppRegistered = true;
}

app.use((error, _request, response, _next) => {
  const status = error.status || 500;
  response.status(status).json({
    ok: false,
    message: error.originalError?.message || error.message || "服务器错误",
  });
});

function startServer(options = {}) {
  const {
    port = defaultPort,
    host = defaultHost,
    webDistPath = process.env.WEB_DIST_PATH,
    stateDir = process.env.APP_STATE_DIR,
  } = options;

  if (stateDir) {
    appStateDir = path.resolve(stateDir);
  }
  registerWebAppRoutes(webDistPath);

  return new Promise((resolve, reject) => {
    const server = app.listen(port, host, () => {
      const address = server.address();
      const addressText =
        typeof address === "object" && address
          ? `http://${address.address === "::" ? "127.0.0.1" : address.address}:${address.port}`
          : `http://${host}:${port}`;
      console.log(`ERP report API listening on ${addressText}`);
      resolve(server);
    });

    server.on("error", reject);
  });
}

if (require.main === module) {
  startServer().catch((error) => {
    console.error(error);
    process.exit(1);
  });
}

module.exports = {
  app,
  startServer,
};

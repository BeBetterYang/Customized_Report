import {
  AlertCircle,
  ChevronDown,
  ChevronUp,
  Columns3,
  Database,
  Download,
  Eye,
  FileText,
  GripVertical,
  ListFilter,
  LoaderCircle,
  Play,
  Plus,
  RefreshCw,
  Search,
  Settings,
  SlidersHorizontal,
  Trash2,
  X,
} from "lucide-react";
import { type ReactNode, useEffect, useMemo, useRef, useState } from "react";

type SqlServerVersion = "2008R2" | "2012" | "2016" | "2019" | "2022";
type FilterControl = "text" | "number" | "date" | "select";
type SortDirection = "asc" | "desc";
type DataValue = string | number | boolean | null;
type DataRow = Record<string, DataValue>;

type DbConnection = {
  id: string;
  name: string;
  host: string;
  port: string;
  instanceName?: string;
  database: string;
  username: string;
  password: string;
  version: SqlServerVersion;
  encrypt: boolean;
  trustServerCertificate: boolean;
  status: "未测试" | "连接成功" | "连接失败";
  statusMessage?: string;
};

type ViewField = {
  name: string;
  sqlType: string;
  required: boolean;
  control: FilterControl;
  nullable?: boolean;
};

type ColumnSpec = {
  field: string;
  label: string;
  sqlType?: string;
  type: "string" | "number" | "date" | "currency" | "status";
};

type ColumnConfig = ColumnSpec & {
  visible: boolean;
  width: number;
  widthCustomized?: boolean;
};

type DatabaseView = {
  schema: string;
  name: string;
  description: string;
  columnCount?: number;
  filters?: ViewField[];
  columns: ColumnConfig[];
  createDate?: string;
  modifyDate?: string;
};

type FilterConfig = {
  paramName: string;
  label: string;
  sqlType: string;
  control: FilterControl;
  required: boolean;
  defaultValue: string;
};

type ReportConfig = {
  id: string;
  title: string;
  databaseId: string;
  viewKey: string;
  filters: FilterConfig[];
  columns: ColumnConfig[];
  sortField: string;
  sortDirection: SortDirection;
  pageSize: number;
};

type ApiConnectionResult = {
  ok: boolean;
  message: string;
  serverVersion?: string;
};

type ApiViewListResult = {
  views: DatabaseView[];
};

type ApiViewMetadataResult = {
  filters: ViewField[];
  columns: ColumnConfig[];
};

type ApiQueryResult = {
  rows: DataRow[];
  columns: ColumnConfig[];
  maxRows?: number;
};

const versionLabels: Record<SqlServerVersion, string> = {
  "2008R2": "SQL Server 2008 R2",
  "2012": "SQL Server 2012",
  "2016": "SQL Server 2016",
  "2019": "SQL Server 2019",
  "2022": "SQL Server 2022",
};

const emptyDatabase: DbConnection = {
  id: "",
  name: "",
  host: "",
  port: "1433",
  instanceName: "",
  database: "",
  username: "",
  password: "",
  version: "2016",
  encrypt: false,
  trustServerCertificate: true,
  status: "未测试",
};

function useLocalStorageState<T>(key: string, fallback: T) {
  const [value, setValue] = useState<T>(() => {
    const raw = localStorage.getItem(key);
    return raw ? (JSON.parse(raw) as T) : fallback;
  });

  useEffect(() => {
    localStorage.setItem(key, JSON.stringify(value));
  }, [key, value]);

  return [value, setValue] as const;
}

async function apiPost<T>(path: string, body: unknown): Promise<T> {
  const response = await fetch(`/api${path}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw new Error(payload.message || `接口请求失败：${response.status}`);
  }
  return payload as T;
}

function getViewKey(view: Pick<DatabaseView, "schema" | "name">) {
  return `${view.schema}.${view.name}`;
}

function parseViewKey(key: string) {
  const [schema = "dbo", ...rest] = key.split(".");
  return { schema, name: rest.join(".") || key };
}

function displayViewName(key: string) {
  const view = parseViewKey(key);
  return `${view.schema}.${view.name}`;
}

function humanizeFieldName(name: string) {
  return name.replace(/_/g, " ").replace(/([A-Z])/g, " $1").trim() || name;
}

function toFilters(fields: ViewField[]): FilterConfig[] {
  return fields.map((field) => ({
    paramName: field.name,
    label: humanizeFieldName(field.name),
    sqlType: field.sqlType,
    control: field.control,
    required: false,
    defaultValue: "",
  }));
}

function defaultColumnWidth(index: number) {
  return index === 0 ? 160 : 130;
}

function normalizeColumns(columns: ColumnConfig[]): ColumnConfig[] {
  return columns.map((column, index) => ({
    ...column,
    label: column.label || column.field,
    visible: column.visible ?? true,
    width: column.width || defaultColumnWidth(index),
    widthCustomized: column.widthCustomized ?? Boolean(column.width && column.width !== defaultColumnWidth(index)),
  }));
}

function inferColumnType(value: DataValue): ColumnSpec["type"] {
  if (typeof value === "number") return "number";
  return "string";
}

function columnsFromRows(rows: DataRow[]): ColumnConfig[] {
  const sample = rows[0] || {};
  return Object.keys(sample).map((field, index) => ({
    field,
    label: field,
    type: inferColumnType(sample[field]),
    visible: true,
    width: defaultColumnWidth(index),
    widthCustomized: false,
  }));
}

function mergeColumns(existing: ColumnConfig[], incoming: ColumnConfig[]) {
  const existingByField = new Map(existing.map((column) => [column.field, column]));
  return normalizeColumns(incoming).map((column) => {
    const saved = existingByField.get(column.field);
    if (!saved) return column;
    const savedWidthCustomized = saved.widthCustomized ?? Boolean(saved.width && saved.width !== column.width);
    return {
      ...column,
      label: saved.label || column.label,
      visible: saved.visible,
      width: savedWidthCustomized ? saved.width : column.width,
      widthCustomized: savedWidthCustomized,
      type: saved.type || column.type,
    };
  });
}

function formatValue(value: DataValue, type: ColumnSpec["type"]) {
  if (value === null || value === undefined) return "";
  if (typeof value === "boolean") return value ? "是" : "否";
  if (type === "currency") {
    const numberValue = Number(value);
    return Number.isFinite(numberValue) ? numberValue.toLocaleString("zh-CN", { style: "currency", currency: "CNY" }) : String(value);
  }
  if (type === "number") {
    const numberValue = Number(value);
    return Number.isFinite(numberValue) ? numberValue.toLocaleString("zh-CN") : String(value);
  }
  return String(value);
}

function compareValues(left: DataValue, right: DataValue, direction: SortDirection) {
  if (left === right) return 0;
  if (left === null || left === undefined) return 1;
  if (right === null || right === undefined) return -1;
  const result =
    typeof left === "number" && typeof right === "number"
      ? left - right
      : String(left).localeCompare(String(right), "zh-CN", { numeric: true });
  return direction === "asc" ? result : -result;
}

function buildFilterDefaults(filters: FilterConfig[]) {
  return filters.reduce<Record<string, string>>((values, filter) => {
    if (filter.control === "date") {
      values[`${filter.paramName}__start`] = filter.defaultValue || "";
      values[`${filter.paramName}__end`] = "";
      return values;
    }
    values[filter.paramName] = filter.defaultValue;
    return values;
  }, {});
}

function getViewTitle(view: string, reports: ReportConfig[]) {
  if (view === "databases") return "数据库管理";
  if (view === "reports") return "报表管理";
  if (view.startsWith("report:")) {
    const reportId = view.replace("report:", "");
    return reports.find((report) => report.id === reportId)?.title ?? "报表";
  }
  return "页面";
}

function csvEscape(value: DataValue) {
  const text = value === null || value === undefined ? "" : String(value);
  return `"${text.replace(/"/g, '""')}"`;
}

function App() {
  const [databases, setDatabases] = useLocalStorageState<DbConnection[]>("erp-real-report-databases", []);
  const [reports, setReports] = useLocalStorageState<ReportConfig[]>("erp-view-report-configs", []);
  const [activeView, setActiveView] = useState("databases");
  const [openTabs, setOpenTabs] = useState<string[]>(["databases"]);
  const activeReport = reports.find((report) => activeView === `report:${report.id}`);

  function updateReport(reportId: string, updater: (report: ReportConfig) => ReportConfig) {
    setReports((current) => current.map((report) => (report.id === reportId ? updater(report) : report)));
  }

  function openView(view: string) {
    setOpenTabs((current) => (current.includes(view) ? current : [...current, view]));
    setActiveView(view);
  }

  function closeTab(view: string) {
    setOpenTabs((current) => {
      const nextTabs = current.filter((item) => item !== view);
      if (activeView === view) {
        const closedIndex = current.indexOf(view);
        const nextActive = nextTabs[Math.max(0, closedIndex - 1)] ?? nextTabs[0] ?? "databases";
        setActiveView(nextActive);
        return nextTabs.length ? nextTabs : [nextActive];
      }
      return nextTabs.length ? nextTabs : ["databases"];
    });
  }

  return (
    <div className="app-shell">
      <aside className="sidebar">
        <div className="brand">
          <div className="brand-mark">R</div>
          <div>
            <strong>ERP 报表后台</strong>
            <span>SqlServer View Reports</span>
          </div>
        </div>

        <nav className="nav">
          <button className={activeView === "databases" ? "active" : ""} onClick={() => openView("databases")}>
            <Database size={18} />
            数据库管理
          </button>
          <button className={activeView === "reports" ? "active" : ""} onClick={() => openView("reports")}>
            <Settings size={18} />
            报表管理
          </button>
          <div className="nav-group">报表菜单</div>
          {reports.map((report) => (
            <button
              key={report.id}
              className={activeView === `report:${report.id}` ? "active" : ""}
              onClick={() => openView(`report:${report.id}`)}
            >
              <FileText size={18} />
              {report.title}
            </button>
          ))}
        </nav>
      </aside>

      <main className="workspace">
        <div className="workspace-tabs">
          {openTabs.map((tab) => (
            <button key={tab} className={activeView === tab ? "active" : ""} onClick={() => setActiveView(tab)}>
              <span>{getViewTitle(tab, reports)}</span>
              <X
                size={14}
                onClick={(event) => {
                  event.stopPropagation();
                  closeTab(tab);
                }}
              />
            </button>
          ))}
        </div>
        <div className="workspace-content">
          {openTabs.includes("databases") && (
            <div className={`workspace-tab-panel ${activeView === "databases" ? "active" : ""}`}>
              <DatabaseManager databases={databases} onChange={setDatabases} />
            </div>
          )}
          {openTabs.includes("reports") && (
            <div className={`workspace-tab-panel ${activeView === "reports" ? "active" : ""}`}>
              <ReportManager
                databases={databases}
                reports={reports}
                onCreate={(report) => {
                  setReports((current) => [report, ...current]);
                  openView(`report:${report.id}`);
                }}
                onUpdate={(updatedReport) => {
                  setReports((current) => current.map((report) => (report.id === updatedReport.id ? updatedReport : report)));
                }}
                onDelete={(reportId) => {
                  setReports((current) => current.filter((report) => report.id !== reportId));
                  setOpenTabs((current) => current.filter((tab) => tab !== `report:${reportId}`));
                  if (activeView === `report:${reportId}`) openView("reports");
                }}
              />
            </div>
          )}
          {reports
            .filter((report) => openTabs.includes(`report:${report.id}`))
            .map((report) => (
              <div key={report.id} className={`workspace-tab-panel ${activeView === `report:${report.id}` ? "active" : ""}`}>
                <ReportRunner
                  report={report}
                  database={databases.find((db) => db.id === report.databaseId)}
                  onUpdate={(updater) => updateReport(report.id, updater)}
                />
              </div>
            ))}
        </div>
      </main>
    </div>
  );
}

function DatabaseManager({
  databases,
  onChange,
}: {
  databases: DbConnection[];
  onChange: (next: DbConnection[] | ((current: DbConnection[]) => DbConnection[])) => void;
}) {
  const [draft, setDraft] = useState<DbConnection>(emptyDatabase);
  const [testing, setTesting] = useState(false);

  function save(payload = draft) {
    if (!payload.name || !payload.host || !payload.database || !payload.username) return;
    const next = { ...payload, id: payload.id || crypto.randomUUID() };
    onChange((current) => {
      const exists = current.some((db) => db.id === next.id);
      return exists ? current.map((db) => (db.id === next.id ? next : db)) : [next, ...current];
    });
    setDraft(emptyDatabase);
  }

  async function testConnection() {
    setTesting(true);
    try {
      const result = await apiPost<ApiConnectionResult>("/databases/test", { database: draft });
      setDraft({ ...draft, status: "连接成功", statusMessage: result.message });
    } catch (error) {
      setDraft({ ...draft, status: "连接失败", statusMessage: error instanceof Error ? error.message : "连接失败" });
    } finally {
      setTesting(false);
    }
  }

  return (
    <section className="page">
      <PageTitle icon={<Database size={24} />} title="数据库管理" subtitle="维护真实 SqlServer 连接参数，测试通过后即可读取数据库视图。" />

      <div className="split-layout">
        <div className="panel">
          <div className="panel-title">连接列表</div>
          {databases.length === 0 ? (
            <EmptyState text="还没有数据库连接，请先在右侧添加 ERP SqlServer 连接。" />
          ) : (
            <div className="db-list">
              {databases.map((db) => (
                <article className="db-item" key={db.id}>
                  <div>
                    <strong>{db.name}</strong>
                    <span>
                      {db.host}:{db.port} / {db.database}
                    </span>
                    {db.statusMessage && <small>{db.statusMessage}</small>}
                  </div>
                  <div className="db-meta">
                    <span>{versionLabels[db.version]}</span>
                    <span className={`status ${db.status === "连接成功" ? "ok" : db.status === "连接失败" ? "bad" : ""}`}>{db.status}</span>
                    <button className="icon-button" title="编辑" onClick={() => setDraft(db)}>
                      <Settings size={16} />
                    </button>
                    <button className="icon-button danger" title="删除" onClick={() => onChange((current) => current.filter((item) => item.id !== db.id))}>
                      <Trash2 size={16} />
                    </button>
                  </div>
                </article>
              ))}
            </div>
          )}
        </div>

        <div className="panel editor-panel">
          <div className="panel-title">{draft.id ? "编辑数据库" : "新增数据库"}</div>
          <div className="form-grid two">
            <label>
              连接名称
              <input value={draft.name} onChange={(event) => setDraft({ ...draft, name: event.target.value })} placeholder="ERP生产库" />
            </label>
            <label>
              数据库版本
              <select value={draft.version} onChange={(event) => setDraft({ ...draft, version: event.target.value as SqlServerVersion })}>
                {Object.entries(versionLabels).map(([value, label]) => (
                  <option key={value} value={value}>
                    {label}
                  </option>
                ))}
              </select>
            </label>
            <label>
              主机地址
              <input value={draft.host} onChange={(event) => setDraft({ ...draft, host: event.target.value })} placeholder="192.168.10.21" />
            </label>
            <label>
              端口
              <input value={draft.port} onChange={(event) => setDraft({ ...draft, port: event.target.value })} placeholder="1433" />
            </label>
            <label>
              实例名
              <input value={draft.instanceName || ""} onChange={(event) => setDraft({ ...draft, instanceName: event.target.value })} placeholder="可选，例如 SQLEXPRESS" />
            </label>
            <label>
              数据库名
              <input value={draft.database} onChange={(event) => setDraft({ ...draft, database: event.target.value })} placeholder="ERP_Main" />
            </label>
            <label>
              登录账号
              <input value={draft.username} onChange={(event) => setDraft({ ...draft, username: event.target.value })} />
            </label>
            <label>
              登录密码
              <input type="password" value={draft.password} onChange={(event) => setDraft({ ...draft, password: event.target.value })} />
            </label>
            <label className="inline-check">
              <input type="checkbox" checked={draft.encrypt} onChange={(event) => setDraft({ ...draft, encrypt: event.target.checked })} />
              启用加密连接
            </label>
            <label className="inline-check">
              <input
                type="checkbox"
                checked={draft.trustServerCertificate}
                onChange={(event) => setDraft({ ...draft, trustServerCertificate: event.target.checked })}
              />
              信任服务器证书
            </label>
          </div>
          {draft.statusMessage && <Notice tone={draft.status === "连接失败" ? "bad" : "ok"} text={draft.statusMessage} />}
          <div className="actions">
            <button className="secondary" onClick={testConnection} disabled={testing}>
              {testing ? <LoaderCircle className="spin" size={16} /> : <Play size={16} />}
              测试连接
            </button>
            <button onClick={() => save()}>
              <Plus size={16} />
              保存连接
            </button>
          </div>
        </div>
      </div>
    </section>
  );
}

function ReportManager({
  databases,
  reports,
  onCreate,
  onUpdate,
  onDelete,
}: {
  databases: DbConnection[];
  reports: ReportConfig[];
  onCreate: (report: ReportConfig) => void;
  onUpdate: (report: ReportConfig) => void;
  onDelete: (reportId: string) => void;
}) {
  const [showBuilder, setShowBuilder] = useState(false);
  const [editingReport, setEditingReport] = useState<ReportConfig | null>(null);

  return (
    <section className="page">
      <PageTitle icon={<Settings size={24} />} title="报表管理" subtitle="选择数据库视图，按视图字段配置筛选条件和数据视图。" />
      <div className="toolbar">
        <button
          onClick={() => {
            setEditingReport(null);
            setShowBuilder(true);
          }}
          disabled={databases.length === 0}
        >
          <Plus size={16} />
          新增报表
        </button>
      </div>

      {databases.length === 0 && <EmptyState text="请先在数据库管理中添加并测试一个 SqlServer 连接。" />}
      {showBuilder && (
        <ReportBuilder
          key={editingReport?.id ?? "new-report"}
          databases={databases}
          initialReport={editingReport ?? undefined}
          onCancel={() => setShowBuilder(false)}
          onSave={(report) => {
            if (editingReport) {
              onUpdate(report);
            } else {
              onCreate(report);
            }
            setShowBuilder(false);
            setEditingReport(null);
          }}
        />
      )}

      <div className="report-grid">
        {reports.map((report) => {
          const db = databases.find((item) => item.id === report.databaseId);
          return (
            <article className="report-card" key={report.id}>
              <div>
                <strong>{report.title}</strong>
                <span>{displayViewName(report.viewKey)}</span>
              </div>
              <div className="card-foot">
                <span>{db?.name ?? "数据库已删除"}</span>
                <div className="report-card-actions">
                  <button
                    className="icon-button"
                    title="编辑"
                    onClick={() => {
                      setEditingReport(report);
                      setShowBuilder(true);
                    }}
                  >
                    <Settings size={16} />
                  </button>
                  <button className="icon-button danger" title="删除" onClick={() => onDelete(report.id)}>
                    <Trash2 size={16} />
                  </button>
                </div>
              </div>
            </article>
          );
        })}
      </div>
    </section>
  );
}

function ReportBuilder({
  databases,
  initialReport,
  onCancel,
  onSave,
}: {
  databases: DbConnection[];
  initialReport?: ReportConfig;
  onCancel: () => void;
  onSave: (report: ReportConfig) => void;
}) {
  const [title, setTitle] = useState(initialReport?.title ?? "");
  const [databaseId, setDatabaseId] = useState(initialReport?.databaseId ?? databases[0]?.id ?? "");
  const [query, setQuery] = useState("");
  const [views, setViews] = useState<DatabaseView[]>([]);
  const [selectedView, setSelectedView] = useState<DatabaseView | null>(null);
  const [filters, setFilters] = useState<FilterConfig[]>(initialReport?.filters ?? []);
  const [columns, setColumns] = useState<ColumnConfig[]>(initialReport?.columns ?? []);
  const [loadingViews, setLoadingViews] = useState(false);
  const [loadingMetadata, setLoadingMetadata] = useState(false);
  const [error, setError] = useState("");

  const selectedDatabase = databases.find((db) => db.id === databaseId);

  useEffect(() => {
    let cancelled = false;
    async function loadViews() {
      if (!selectedDatabase) return;
      setLoadingViews(true);
      setError("");
      setViews([]);
      setSelectedView(null);
      setFilters([]);
      setColumns([]);
      try {
        const result = await apiPost<ApiViewListResult>("/views/list", { database: selectedDatabase });
        if (cancelled) return;
        setViews(result.views);
        const savedView =
          initialReport?.databaseId === selectedDatabase.id
            ? result.views.find((view) => getViewKey(view) === initialReport.viewKey)
            : undefined;
        const nextView = savedView ?? result.views[0];
        if (nextView) {
          await loadMetadata(nextView, selectedDatabase, cancelled, {
            existingColumns: savedView ? initialReport?.columns : undefined,
            existingFilters: savedView ? initialReport?.filters : undefined,
          });
        }
      } catch (loadError) {
        if (!cancelled) setError(loadError instanceof Error ? loadError.message : "加载数据库视图失败");
      } finally {
        if (!cancelled) setLoadingViews(false);
      }
    }
    void loadViews();
    return () => {
      cancelled = true;
    };
  }, [databaseId]);

  function mergeFilters(existing: FilterConfig[] | undefined, incoming: ViewField[]) {
    const existingByField = new Map((existing ?? []).map((filter) => [filter.paramName, filter]));
    return toFilters(incoming)
      .filter((filter) => !existing || existingByField.has(filter.paramName))
      .map((filter) => {
        const saved = existingByField.get(filter.paramName);
        return saved
          ? {
              ...filter,
              label: saved.label || filter.label,
              control: saved.control || filter.control,
              defaultValue: saved.defaultValue ?? filter.defaultValue,
            }
          : filter;
      });
  }

  async function loadMetadata(
    view: DatabaseView,
    database = selectedDatabase,
    cancelled = false,
    preserve?: { existingFilters?: FilterConfig[]; existingColumns?: ColumnConfig[] },
  ) {
    if (!database) return;
    setLoadingMetadata(true);
    setError("");
    setSelectedView(view);
    try {
      const result = await apiPost<ApiViewMetadataResult>("/views/metadata", {
        database,
        view: { schema: view.schema, name: view.name },
      });
      if (cancelled) return;
      const nextColumns = normalizeColumns(result.columns || []);
      const nextFilters = mergeFilters(preserve?.existingFilters, result.filters || []);
      setSelectedView({ ...view, filters: result.filters || [], columns: nextColumns });
      setFilters(nextFilters);
      setColumns(preserve?.existingColumns ? mergeColumns(preserve.existingColumns, nextColumns) : nextColumns);
    } catch (metadataError) {
      if (!cancelled) setError(metadataError instanceof Error ? metadataError.message : "解析视图字段失败");
    } finally {
      if (!cancelled) setLoadingMetadata(false);
    }
  }

  const viewOptions = views.filter((item) => {
    const text = `${item.schema}.${item.name} ${item.description}`.toLowerCase();
    return text.includes(query.toLowerCase());
  });

  function updateFilter(field: string, patch: Partial<FilterConfig>) {
    setFilters((current) => current.map((item) => (item.paramName === field ? { ...item, ...patch } : item)));
  }

  function createFilterFromColumn(column: ColumnConfig): FilterConfig {
    const viewField = selectedView?.filters?.find((item) => item.name === column.field);
    return {
      paramName: column.field,
      label: column.label || humanizeFieldName(column.field),
      sqlType: viewField?.sqlType || column.sqlType || "",
      control: viewField?.control || "text",
      required: false,
      defaultValue: "",
    };
  }

  function toggleFilter(column: ColumnConfig, checked: boolean) {
    setFilters((current) => {
      const exists = current.some((item) => item.paramName === column.field);
      if (checked && !exists) return [...current, createFilterFromColumn(column)];
      if (!checked) return current.filter((item) => item.paramName !== column.field);
      return current;
    });
  }

  function save() {
    if (!title || !databaseId || !selectedView) return;
    const sameSource = initialReport?.databaseId === databaseId && initialReport.viewKey === getViewKey(selectedView);
    onSave({
      id: initialReport?.id ?? crypto.randomUUID(),
      title,
      databaseId,
      viewKey: getViewKey(selectedView),
      filters,
      columns,
      sortField: sameSource ? initialReport?.sortField || columns[0]?.field || "" : columns[0]?.field ?? "",
      sortDirection: sameSource ? initialReport?.sortDirection || "desc" : "desc",
      pageSize: initialReport?.pageSize ?? 20,
    });
  }

  return (
    <div className="builder">
      <div className="builder-head">
        <div>
          <strong>{initialReport ? "编辑报表" : "新增报表"}</strong>
          <span>选择数据库视图后，字段会自动生成筛选条件和表格字段。</span>
        </div>
        <div>
          <button className="secondary" onClick={onCancel}>
            取消
          </button>
          <button onClick={save} disabled={!title || !selectedView}>
            保存报表
          </button>
        </div>
      </div>

      <div className="builder-top">
        <label>
          报表名称
          <input value={title} onChange={(event) => setTitle(event.target.value)} placeholder="例如：客户应收视图报表" />
        </label>
        <label>
          选择数据库
          <select value={databaseId} onChange={(event) => setDatabaseId(event.target.value)}>
            {databases.map((db) => (
              <option key={db.id} value={db.id}>
                {db.name} - {versionLabels[db.version]}
              </option>
            ))}
          </select>
        </label>
      </div>

      {error && <Notice tone="bad" text={error} />}

      <div className="builder-layout">
        <div className="panel inner source-panel">
          <div className="panel-title">数据库视图</div>
          <label className="search-box">
            <Search size={16} />
            <input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="搜索视图名称或说明" />
          </label>
          <div className="procedure-list">
            {loadingViews ? (
              <LoadingText text="正在读取数据库视图..." />
            ) : viewOptions.length === 0 ? (
              <EmptyState text="没有读取到可用视图。" />
            ) : (
              viewOptions.map((item) => {
                const key = getViewKey(item);
                const selected = selectedView && getViewKey(selectedView) === key;
                return (
                  <button key={key} className={selected ? "selected" : ""} onClick={() => void loadMetadata(item)}>
                    <strong>{key}</strong>
                    <span>
                      {item.columnCount ?? 0} 个字段 · {item.description || "无说明"}
                    </span>
                  </button>
                );
              })
            )}
          </div>
        </div>

        <div className="panel inner field-panel">
          <div className="field-panel-head">
            <div>
              <div className="panel-title">字段配置</div>
              <span>{selectedView ? displayViewName(getViewKey(selectedView)) : "未选择视图"}</span>
            </div>
            <Eye size={18} />
          </div>

          {loadingMetadata ? (
            <LoadingText text="正在解析视图字段..." />
          ) : columns.length === 0 ? (
            <EmptyState text="选择视图后会在这里配置字段筛选条件。" />
          ) : (
            <div className="field-config-table">
              <div className="field-config-row head">
                <span>字段</span>
                <span>类型</span>
                <span>筛选名称</span>
                <span>控件</span>
                <span>筛选</span>
              </div>
              {columns.map((column) => {
                const filter = filters.find((item) => item.paramName === column.field);
                const filterEnabled = Boolean(filter);
                return (
                  <div className="field-config-row" key={column.field}>
                    <span className="param-name" title={column.field}>
                      {column.field}
                    </span>
                    <span className="sql-type" title={column.sqlType || ""}>
                      {column.sqlType || "-"}
                    </span>
                    <input disabled={!filterEnabled} value={filter?.label || column.label} onChange={(event) => updateFilter(column.field, { label: event.target.value })} />
                    <select disabled={!filterEnabled} value={filter?.control || "text"} onChange={(event) => updateFilter(column.field, { control: event.target.value as FilterControl })}>
                      <option value="text">文本</option>
                      <option value="number">数字</option>
                      <option value="date">日期</option>
                      <option value="select">选项</option>
                    </select>
                    <label className="table-check">
                      <input type="checkbox" checked={filterEnabled} onChange={(event) => toggleFilter(column, event.target.checked)} />
                    </label>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

function ReportRunner({
  report,
  database,
  onUpdate,
}: {
  report: ReportConfig;
  database?: DbConnection;
  onUpdate: (updater: (report: ReportConfig) => ReportConfig) => void;
}) {
  const [expanded, setExpanded] = useState(false);
  const [page, setPage] = useState(1);
  const [showColumns, setShowColumns] = useState(false);
  const [filterValues, setFilterValues] = useState<Record<string, string>>(() => buildFilterDefaults(report.filters));
  const [rows, setRows] = useState<DataRow[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [maxRows, setMaxRows] = useState<number | null>(null);
  const [draggedColumnField, setDraggedColumnField] = useState<string | null>(null);
  const [hasQueried, setHasQueried] = useState(false);
  const columnMenuRef = useRef<HTMLDivElement>(null);

  const visibleColumns = report.columns
    .map((column, index) => ({
      ...column,
      widthCustomized: column.widthCustomized ?? Boolean(column.width && column.width !== defaultColumnWidth(index)),
    }))
    .filter((column) => column.visible);
  const hasCustomColumnWidth = visibleColumns.some((column) => column.widthCustomized);
  const sortedRows = useMemo(() => {
    if (!report.sortField) return rows;
    return [...rows].sort((left, right) => compareValues(left[report.sortField], right[report.sortField], report.sortDirection));
  }, [rows, report.sortField, report.sortDirection]);
  const pageCount = Math.max(1, Math.ceil(sortedRows.length / report.pageSize));
  const pageRows = sortedRows.slice((page - 1) * report.pageSize, page * report.pageSize);
  const tableWidth = hasCustomColumnWidth ? 56 + visibleColumns.reduce((total, column) => total + column.width, 0) : undefined;

  useEffect(() => {
    const defaults = buildFilterDefaults(report.filters);
    setFilterValues(defaults);
    setRows([]);
    setPage(1);
    setHasQueried(false);
    setMaxRows(null);
    setError("");
  }, [report.id]);

  useEffect(() => {
    setPage(1);
  }, [report.pageSize, report.sortField, report.sortDirection, rows.length]);

  useEffect(() => {
    if (!showColumns) return;
    function closeColumnMenu(event: MouseEvent) {
      if (columnMenuRef.current && !columnMenuRef.current.contains(event.target as Node)) {
        setShowColumns(false);
      }
    }
    document.addEventListener("mousedown", closeColumnMenu);
    return () => document.removeEventListener("mousedown", closeColumnMenu);
  }, [showColumns]);

  function updateColumn(field: string, patch: Partial<ColumnConfig>) {
    onUpdate((current) => ({
      ...current,
      columns: current.columns.map((column) => (column.field === field ? { ...column, ...patch } : column)),
    }));
  }

  function reorderColumn(sourceField: string, targetField: string) {
    if (sourceField === targetField) return;
    onUpdate((current) => {
      const index = current.columns.findIndex((column) => column.field === sourceField);
      const targetIndex = current.columns.findIndex((column) => column.field === targetField);
      if (index < 0 || targetIndex < 0) return current;
      const nextColumns = [...current.columns];
      const [moved] = nextColumns.splice(index, 1);
      nextColumns.splice(targetIndex, 0, moved);
      return { ...current, columns: nextColumns };
    });
  }

  function freezeVisibleColumnWidths(widths: Record<string, number>) {
    onUpdate((current) => ({
      ...current,
      columns: current.columns.map((column) => {
        const width = widths[column.field];
        return width ? { ...column, width: Math.max(44, width), widthCustomized: true } : column;
      }),
    }));
  }

  function startResize(field: string, startX: number, startWidth: number, widths: Record<string, number>) {
    freezeVisibleColumnWidths(widths);
    function onMove(event: MouseEvent) {
      const nextWidth = Math.max(44, startWidth + event.clientX - startX);
      onUpdate((current) => ({
        ...current,
        columns: current.columns.map((column) => {
          const frozenWidth = widths[column.field];
          if (column.field === field) return { ...column, width: nextWidth, widthCustomized: true };
          return frozenWidth ? { ...column, width: Math.max(44, frozenWidth), widthCustomized: true } : column;
        }),
      }));
    }
    function onUp() {
      window.removeEventListener("mousemove", onMove);
      window.removeEventListener("mouseup", onUp);
    }
    window.addEventListener("mousemove", onMove);
    window.addEventListener("mouseup", onUp);
  }

  async function runQuery(values = filterValues) {
    if (!database) {
      setError("当前报表关联的数据库不存在，请在报表管理中重新配置。");
      return;
    }
    setLoading(true);
    setHasQueried(true);
    setError("");
    try {
      const result = await apiPost<ApiQueryResult>("/views/query", {
        database,
        view: parseViewKey(report.viewKey),
        maxRows: 10000,
        filters: report.filters.map((filter) => ({
          field: filter.paramName,
          sqlType: filter.sqlType,
          control: filter.control,
          value:
            filter.control === "date"
              ? {
                  start: values[`${filter.paramName}__start`] ?? "",
                  end: values[`${filter.paramName}__end`] ?? "",
                }
              : values[filter.paramName] ?? "",
        })),
      });
      const incomingColumns = result.columns?.length ? result.columns : columnsFromRows(result.rows || []);
      setRows(result.rows || []);
      setMaxRows(result.maxRows || null);
      if (incomingColumns.length > 0) {
        onUpdate((current) => ({
          ...current,
          sortField: current.sortField || incomingColumns[0].field,
          columns: mergeColumns(current.columns, incomingColumns),
        }));
      }
    } catch (queryError) {
      setError(queryError instanceof Error ? queryError.message : "查询数据库视图失败");
      setRows([]);
    } finally {
      setLoading(false);
    }
  }

  function exportCurrentData() {
    if (!hasQueried || sortedRows.length === 0 || visibleColumns.length === 0) return;
    const header = visibleColumns.map((column) => csvEscape(column.label)).join(",");
    const body = sortedRows
      .map((row) => visibleColumns.map((column) => csvEscape(formatValue(row[column.field], column.type))).join(","))
      .join("\n");
    const blob = new Blob([`\uFEFF${header}\n${body}`], { type: "text/csv;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = `${report.title || "报表数据"}.csv`;
    document.body.appendChild(link);
    link.click();
    link.remove();
    URL.revokeObjectURL(url);
  }

  return (
    <section className="page report-query-page">
      <PageTitle icon={<FileText size={24} />} title={report.title} subtitle={`${database?.name ?? "未找到数据库"} / ${displayViewName(report.viewKey)}`} />

      <div className={`filter-band ${expanded ? "expanded" : ""}`}>
        <div className="filter-row">
          {report.filters.map((filter) => {
            if (filter.control === "date") {
              const startKey = `${filter.paramName}__start`;
              const endKey = `${filter.paramName}__end`;
              return [
                <label key={startKey}>
                  <span className="filter-label-text">{filter.label}开始</span>
                  <input type="date" value={filterValues[startKey] ?? ""} onChange={(event) => setFilterValues({ ...filterValues, [startKey]: event.target.value })} />
                </label>,
                <label key={endKey}>
                  <span className="filter-label-text">{filter.label}结束</span>
                  <input type="date" value={filterValues[endKey] ?? ""} onChange={(event) => setFilterValues({ ...filterValues, [endKey]: event.target.value })} />
                </label>,
              ];
            }
            return (
              <label key={filter.paramName}>
                <span className="filter-label-text">{filter.label}</span>
                {filter.control === "select" ? (
                  <select value={filterValues[filter.paramName] ?? ""} onChange={(event) => setFilterValues({ ...filterValues, [filter.paramName]: event.target.value })}>
                    <option value="">全部</option>
                    {filter.sqlType.toLowerCase().includes("bit") && (
                      <>
                        <option value="1">是</option>
                        <option value="0">否</option>
                      </>
                    )}
                  </select>
                ) : (
                  <input
                    type={filter.control === "number" ? "number" : "text"}
                    value={filterValues[filter.paramName] ?? ""}
                    onChange={(event) => setFilterValues({ ...filterValues, [filter.paramName]: event.target.value })}
                  />
                )}
              </label>
            );
          })}
        </div>
        <div className="filter-actions">
          {report.filters.length > 0 && (
            <button className="secondary" onClick={() => setExpanded(!expanded)}>
              {expanded ? <ChevronUp size={16} /> : <ChevronDown size={16} />}
              {expanded ? "收起筛选" : "展开筛选"}
            </button>
          )}
          <button onClick={() => void runQuery()} disabled={loading}>
            {loading ? <LoaderCircle className="spin" size={16} /> : <ListFilter size={16} />}
            查询
          </button>
        </div>
      </div>

      {error && <Notice tone="bad" text={error} />}

      <div className="data-panel">
        <div className="table-toolbar">
          <div>
            <strong>数据视图</strong>
            <span>{maxRows && sortedRows.length >= maxRows ? `已限制最多 ${maxRows} 条` : "按当前筛选条件查询"}</span>
          </div>
          <div className="table-actions">
            <label className="merged-control sort-field">
              <span className="filter-label-text">排序</span>
              <select value={report.sortField} onChange={(event) => onUpdate((current) => ({ ...current, sortField: event.target.value }))}>
                {report.columns.map((column) => (
                  <option key={column.field} value={column.field}>
                    {column.label}
                  </option>
                ))}
              </select>
            </label>
            <button className="secondary" onClick={() => onUpdate((current) => ({ ...current, sortDirection: current.sortDirection === "asc" ? "desc" : "asc" }))}>
              <SlidersHorizontal size={16} />
              {report.sortDirection === "asc" ? "升序" : "降序"}
            </button>
            <button className="secondary" onClick={() => void runQuery()} disabled={loading}>
              <RefreshCw size={16} />
              刷新
            </button>
            <button className="secondary" onClick={exportCurrentData} disabled={!hasQueried || sortedRows.length === 0}>
              <Download size={16} />
              导出
            </button>
            <div className="column-menu" ref={columnMenuRef}>
              <button className="secondary" onClick={() => setShowColumns(!showColumns)} disabled={report.columns.length === 0}>
                <Columns3 size={16} />
                字段
              </button>
              {showColumns && (
                <div className="column-popover">
                  <div className="column-popover-head">字段顺序</div>
                  {report.columns.map((column) => (
                    <div
                      className={`column-order-row ${draggedColumnField === column.field ? "dragging" : ""}`}
                      draggable
                      key={column.field}
                      onDragStart={(event) => {
                        event.dataTransfer.effectAllowed = "move";
                        event.dataTransfer.setData("text/plain", column.field);
                        setDraggedColumnField(column.field);
                      }}
                      onDragOver={(event) => {
                        event.preventDefault();
                        event.dataTransfer.dropEffect = "move";
                      }}
                      onDrop={(event) => {
                        event.preventDefault();
                        const sourceField = event.dataTransfer.getData("text/plain") || draggedColumnField;
                        if (sourceField) reorderColumn(sourceField, column.field);
                        setDraggedColumnField(null);
                      }}
                      onDragEnd={() => setDraggedColumnField(null)}
                    >
                      <GripVertical className="drag-handle" size={16} />
                      <label>
                        <input type="checkbox" checked={column.visible} onChange={(event) => updateColumn(column.field, { visible: event.target.checked })} />
                        <span title={column.label}>{column.label}</span>
                      </label>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>
        </div>

        <div className="table-scroll">
          {loading ? (
            <div className="table-state">
              <LoaderCircle className="spin" size={20} />
              正在查询数据库视图...
            </div>
          ) : visibleColumns.length === 0 ? (
            <div className="table-state">暂无字段，请确认视图返回结果集。</div>
          ) : !hasQueried ? (
            <div className="table-state">请设置筛选条件后点击查询。</div>
          ) : sortedRows.length === 0 ? (
            <div className="table-state">暂无数据。</div>
          ) : (
            <table className={hasCustomColumnWidth ? "fixed-width-table" : "auto-width-table"} style={tableWidth ? { width: tableWidth, minWidth: "100%" } : undefined}>
              <colgroup>
                <col style={{ width: 56 }} />
                {visibleColumns.map((column) => (
                  <col key={column.field} style={column.widthCustomized ? { width: column.width } : undefined} />
                ))}
              </colgroup>
              <thead>
                <tr>
                  <th className="row-number-cell">序号</th>
                  {visibleColumns.map((column) => (
                    <th key={column.field} data-field={column.field} style={column.widthCustomized ? { width: column.width, maxWidth: column.width } : undefined}>
                      {column.label}
                      <span
                        className="resize-handle"
                        onMouseDown={(event) => {
                          const headerRow = event.currentTarget.closest("tr");
                          const widths = Object.fromEntries(
                            Array.from(headerRow?.querySelectorAll<HTMLTableCellElement>("th[data-field]") ?? []).map((cell) => [
                              cell.dataset.field || "",
                              cell.getBoundingClientRect().width,
                            ]),
                          );
                          startResize(column.field, event.clientX, widths[column.field] ?? column.width, widths);
                        }}
                      />
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {pageRows.map((row, index) => (
                  <tr key={index}>
                    <td className="row-number-cell">{(page - 1) * report.pageSize + index + 1}</td>
                    {visibleColumns.map((column) => (
                      <td key={column.field} style={column.widthCustomized ? { width: column.width, maxWidth: column.width } : undefined}>
                        {column.type === "status" ? <span className="tag">{formatValue(row[column.field], column.type)}</span> : formatValue(row[column.field], column.type)}
                      </td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>

        <div className="pagination">
          <label>
            每页
            <select value={report.pageSize} onChange={(event) => onUpdate((current) => ({ ...current, pageSize: Number(event.target.value) }))}>
              {[10, 20, 50, 100].map((size) => (
                <option key={size} value={size}>
                  {size} 条
                </option>
              ))}
            </select>
          </label>
          <span className="pagination-total">
            共 {sortedRows.length} 条{maxRows && sortedRows.length >= maxRows ? `，最多显示 ${maxRows} 条` : ""}
          </span>
          <button className="secondary" disabled={page <= 1} onClick={() => setPage((current) => current - 1)}>
            上一页
          </button>
          <span>
            第 {page} / {pageCount} 页
          </span>
          <button className="secondary" disabled={page >= pageCount} onClick={() => setPage((current) => current + 1)}>
            下一页
          </button>
        </div>
      </div>
    </section>
  );
}

function PageTitle({ icon, title, subtitle }: { icon: ReactNode; title: string; subtitle: string }) {
  return (
    <header className="page-title">
      <div className="title-icon">{icon}</div>
      <div>
        <h1>{title}</h1>
        <p>{subtitle}</p>
      </div>
    </header>
  );
}

function EmptyState({ text }: { text: string }) {
  return <div className="empty-state">{text}</div>;
}

function LoadingText({ text }: { text: string }) {
  return (
    <div className="loading-inline">
      <LoaderCircle className="spin" size={16} />
      {text}
    </div>
  );
}

function Notice({ text, tone }: { text: string; tone: "ok" | "warn" | "bad" }) {
  return (
    <div className={`notice ${tone}`}>
      <AlertCircle size={16} />
      {text}
    </div>
  );
}

export { App };

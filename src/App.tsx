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
  Home,
  ListFilter,
  LoaderCircle,
  PanelLeftClose,
  PanelLeftOpen,
  Play,
  Plus,
  RefreshCw,
  Save,
  Search,
  Settings,
  SlidersHorizontal,
  Trash2,
  X,
} from "lucide-react";
import { type CSSProperties, type KeyboardEvent as ReactKeyboardEvent, type ReactNode, type SetStateAction, useEffect, useMemo, useRef, useState } from "react";

type SqlServerVersion = "2008R2" | "2012" | "2016" | "2019" | "2022";
type FilterControl = "text" | "number" | "date" | "select";
type SortDirection = "asc" | "desc";
type DataValue = string | number | boolean | null;
type DataRow = Record<string, DataValue>;
type DateRangePreset = "" | "today" | "this-week" | "this-month" | "this-year";
type SavedFilterValues = Record<string, string>;

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
  optionValues?: string[];
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
  drilldownEnabled?: boolean;
  drilldownViewKey?: string;
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
  visible?: boolean;
  optionValues?: string[];
};

type ReportConfig = {
  id: string;
  title: string;
  databaseId: string;
  viewKey: string;
  filters: FilterConfig[];
  savedFilterValues?: SavedFilterValues;
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

type DrilldownResult = {
  viewKey: string;
  sourceField: string;
  sourceLabel: string;
  sourceSqlType: string;
  sourceType: ColumnSpec["type"];
  value: DataValue;
  rows: DataRow[];
  columns: ColumnConfig[];
  maxRows: number | null;
};

const versionLabels: Record<SqlServerVersion, string> = {
  "2008R2": "SQL Server 2008 R2",
  "2012": "SQL Server 2012",
  "2016": "SQL Server 2016",
  "2019": "SQL Server 2019",
  "2022": "SQL Server 2022",
};

const managementPassword = "fzrj@1911";

const dateRangePresets: Array<{ value: DateRangePreset; label: string }> = [
  { value: "", label: "自定义" },
  { value: "today", label: "今天" },
  { value: "this-week", label: "本周" },
  { value: "this-month", label: "本月" },
  { value: "this-year", label: "本年" },
];

const datePresetValues = new Set<DateRangePreset>(dateRangePresets.map((preset) => preset.value));
const remoteOnlyStateKeys = new Set(["erp-real-report-databases"]);

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

function usePersistedState<T>(key: string, fallback: T) {
  const fallbackRef = useRef(fallback);
  const [value, setValue] = useState<T>(fallbackRef.current);
  const [hydrated, setHydrated] = useState(false);
  const remoteOnly = remoteOnlyStateKeys.has(key);

  function readLocalValue() {
    if (remoteOnly) {
      try {
        localStorage.removeItem(key);
      } catch {
        // Ignore restricted storage.
      }
      return fallbackRef.current;
    }
    try {
      const raw = localStorage.getItem(key);
      return raw ? (JSON.parse(raw) as T) : fallbackRef.current;
    } catch {
      return fallbackRef.current;
    }
  }

  function writeLocalValue(nextValue: T) {
    if (remoteOnly) {
      try {
        localStorage.removeItem(key);
      } catch {
        // Ignore restricted storage.
      }
      return;
    }
    try {
      localStorage.setItem(key, JSON.stringify(nextValue));
    } catch {
      // Browser storage can be unavailable in restricted contexts.
    }
  }

  function writeRemoteValue(nextValue: T) {
    void fetch(`/api/state/${encodeURIComponent(key)}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ value: nextValue }),
    }).catch(() => {
      // The browser-only mode has no state API; localStorage remains the fallback.
    });
  }

  function chooseInitialValue(remoteValue: T | null | undefined, localValue: T) {
    if (remoteOnly) {
      return remoteValue ?? fallbackRef.current;
    }
    if (
      Array.isArray(remoteValue) &&
      remoteValue.length === 0 &&
      Array.isArray(localValue) &&
      localValue.length > 0
    ) {
      return localValue;
    }
    return remoteValue ?? localValue;
  }

  useEffect(() => {
    let cancelled = false;

    async function loadState() {
      const localValue = readLocalValue();
      try {
        const response = await fetch(`/api/state/${encodeURIComponent(key)}`);
        if (!response.ok) {
          throw new Error(`state api failed: ${response.status}`);
        }
        const payload = (await response.json()) as { value?: T | null };
        if (!cancelled) {
          setValue(chooseInitialValue(payload.value, localValue));
        }
      } catch {
        if (!cancelled) {
          setValue(localValue);
        }
      } finally {
        if (!cancelled) {
          setHydrated(true);
        }
      }
    }

    void loadState();
    return () => {
      cancelled = true;
    };
  }, [key]);

  useEffect(() => {
    if (!hydrated) return;

    writeLocalValue(value);
    writeRemoteValue(value);
  }, [hydrated, key, value]);

  function setPersistedValue(updater: SetStateAction<T>) {
    setValue((current) => {
      const nextValue = typeof updater === "function" ? (updater as (current: T) => T)(current) : updater;
      writeLocalValue(nextValue);
      writeRemoteValue(nextValue);
      return nextValue;
    });
  }

  return [value, setPersistedValue, hydrated] as const;
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
    visible: true,
    optionValues: field.optionValues || [],
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
      drilldownEnabled: saved.drilldownEnabled ?? column.drilldownEnabled ?? false,
      drilldownViewKey: saved.drilldownViewKey || column.drilldownViewKey || "",
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

function getColumnTotal(rows: DataRow[], field: string) {
  return rows.reduce((total, row) => {
    const value = row[field];
    if (value === null || value === undefined || value === "") {
      return total;
    }
    const numericValue = Number(value);
    return Number.isFinite(numericValue) ? total + numericValue : total;
  }, 0);
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

function formatLocalDate(date: Date) {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function getDatePresetRange(preset: DateRangePreset, now = new Date()) {
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  if (preset === "today") {
    return { start: formatLocalDate(today), end: formatLocalDate(today) };
  }
  if (preset === "this-week") {
    const day = today.getDay();
    const mondayOffset = day === 0 ? -6 : 1 - day;
    const weekStart = new Date(today.getFullYear(), today.getMonth(), today.getDate() + mondayOffset);
    const weekEnd = new Date(weekStart.getFullYear(), weekStart.getMonth(), weekStart.getDate() + 6);
    return { start: formatLocalDate(weekStart), end: formatLocalDate(weekEnd) };
  }
  if (preset === "this-month") {
    return {
      start: formatLocalDate(new Date(today.getFullYear(), today.getMonth(), 1)),
      end: formatLocalDate(new Date(today.getFullYear(), today.getMonth() + 1, 0)),
    };
  }
  if (preset === "this-year") {
    return {
      start: formatLocalDate(new Date(today.getFullYear(), 0, 1)),
      end: formatLocalDate(new Date(today.getFullYear(), 11, 31)),
    };
  }
  return { start: "", end: "" };
}

function getDatePresetValue(value?: string): DateRangePreset {
  return datePresetValues.has(value as DateRangePreset) ? (value as DateRangePreset) : "";
}

function buildFilterDefaults(filters: FilterConfig[], savedValues: SavedFilterValues = {}) {
  return filters.reduce<Record<string, string>>((values, filter) => {
    if (filter.control === "date") {
      const presetKey = `${filter.paramName}__preset`;
      const startKey = `${filter.paramName}__start`;
      const endKey = `${filter.paramName}__end`;
      const preset = getDatePresetValue(savedValues[presetKey]);
      const presetRange = getDatePresetRange(preset);
      values[presetKey] = preset;
      values[startKey] = preset ? presetRange.start : (savedValues[startKey] ?? filter.defaultValue) || "";
      values[endKey] = preset ? presetRange.end : savedValues[endKey] ?? "";
      return values;
    }
    values[filter.paramName] = savedValues[filter.paramName] ?? filter.defaultValue;
    return values;
  }, {});
}

function resolveDatePresetValues(values: Record<string, string>, filters: FilterConfig[]) {
  const next = { ...values };
  filters.forEach((filter) => {
    if (filter.control !== "date") return;
    const preset = getDatePresetValue(next[`${filter.paramName}__preset`]);
    if (!preset) return;
    const range = getDatePresetRange(preset);
    next[`${filter.paramName}__start`] = range.start;
    next[`${filter.paramName}__end`] = range.end;
  });
  return next;
}

function buildSavedFilterValues(filters: FilterConfig[], values: Record<string, string>) {
  return filters.reduce<SavedFilterValues>((savedValues, filter) => {
    if (filter.control === "date") {
      const presetKey = `${filter.paramName}__preset`;
      const startKey = `${filter.paramName}__start`;
      const endKey = `${filter.paramName}__end`;
      const preset = getDatePresetValue(values[presetKey]);
      savedValues[presetKey] = preset;
      savedValues[startKey] = preset ? "" : values[startKey] ?? "";
      savedValues[endKey] = preset ? "" : values[endKey] ?? "";
      return savedValues;
    }
    savedValues[filter.paramName] = values[filter.paramName] ?? "";
    return savedValues;
  }, {});
}

function getViewTitle(view: string, reports: ReportConfig[]) {
  if (view === "home") return "首页";
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
  const [databases, setDatabases, databasesHydrated] = usePersistedState<DbConnection[]>("erp-real-report-databases", []);
  const [reports, setReports, reportsHydrated] = usePersistedState<ReportConfig[]>("erp-view-report-configs", []);
  const [sidebarWidth, setSidebarWidth] = usePersistedState<number>("erp-sidebar-width", 260);
  const [sidebarCollapsed, setSidebarCollapsed] = usePersistedState<boolean>("erp-sidebar-collapsed", false);
  const [activeView, setActiveView] = useState("home");
  const [openTabs, setOpenTabs] = useState<string[]>(["home"]);
  const [showManagementEntries, setShowManagementEntries] = useState(false);
  const [showManagementPasswordPrompt, setShowManagementPasswordPrompt] = useState(false);
  const activeReport = reports.find((report) => activeView === `report:${report.id}`);
  const ready = databasesHydrated && reportsHydrated;

  function hideManagementEntries() {
    setShowManagementEntries(false);
    setShowManagementPasswordPrompt(false);
    setOpenTabs((current) => current.filter((tab) => tab !== "databases" && tab !== "reports"));
    setActiveView((current) => (current === "databases" || current === "reports" ? "home" : current));
  }

  useEffect(() => {
    function handleShortcut(event: KeyboardEvent) {
      const shortcutMatched = (event.ctrlKey || event.metaKey) && event.shiftKey && event.key.toLowerCase() === "m";
      if (!shortcutMatched) {
        return;
      }
      event.preventDefault();
      if (showManagementEntries) {
        hideManagementEntries();
        return;
      }
      setShowManagementPasswordPrompt(true);
    }

    window.addEventListener("keydown", handleShortcut);
    return () => window.removeEventListener("keydown", handleShortcut);
  }, [showManagementEntries]);

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
        const nextActive = nextTabs[Math.max(0, closedIndex - 1)] ?? nextTabs[0] ?? "home";
        setActiveView(nextActive);
        return nextTabs.length ? nextTabs : [nextActive];
      }
      return nextTabs.length ? nextTabs : ["home"];
    });
  }

  function startSidebarResize(startX: number, startWidth: number) {
    setSidebarCollapsed(false);
    function onMove(event: MouseEvent) {
      setSidebarWidth(Math.min(420, Math.max(180, startWidth + event.clientX - startX)));
    }
    function onUp() {
      window.removeEventListener("mousemove", onMove);
      window.removeEventListener("mouseup", onUp);
    }
    window.addEventListener("mousemove", onMove);
    window.addEventListener("mouseup", onUp);
  }

  const shellStyle = {
    "--sidebar-width": `${sidebarCollapsed ? 56 : sidebarWidth}px`,
  } as CSSProperties;

  if (!ready) {
    return (
      <div className="app-shell">
        <main className="workspace">
          <div className="workspace-content">
            <div className="workspace-tab-panel active">
              <section className="page">
                <div className="table-state">
                  <LoaderCircle className="spin" size={20} />
                  正在加载本地配置...
                </div>
              </section>
            </div>
          </div>
        </main>
      </div>
    );
  }

  return (
    <div className={`app-shell ${sidebarCollapsed ? "sidebar-collapsed" : ""}`} style={shellStyle}>
      <aside className="sidebar">
        <div className="brand">
          <div className="brand-mark">R</div>
          <div className="brand-text">
            <strong>报表后台</strong>
          </div>
          <button className="sidebar-toggle" type="button" title={sidebarCollapsed ? "展开菜单" : "收起菜单"} onClick={() => setSidebarCollapsed((current) => !current)}>
            {sidebarCollapsed ? <PanelLeftOpen size={16} /> : <PanelLeftClose size={16} />}
          </button>
        </div>

        <nav className="nav">
          <button className={activeView === "home" ? "active" : ""} onClick={() => openView("home")} title="首页">
            <Home size={18} />
            <span>首页</span>
          </button>
          {showManagementEntries && (
            <>
              <button className={activeView === "databases" ? "active" : ""} onClick={() => openView("databases")} title="数据库管理">
                <Database size={18} />
                <span>数据库管理</span>
              </button>
              <button className={activeView === "reports" ? "active" : ""} onClick={() => openView("reports")} title="报表管理">
                <Settings size={18} />
                <span>报表管理</span>
              </button>
            </>
          )}
          <div className="nav-group">报表菜单</div>
          {reports.map((report) => (
            <button
              key={report.id}
              className={activeView === `report:${report.id}` ? "active" : ""}
              onClick={() => openView(`report:${report.id}`)}
              title={report.title}
            >
              <FileText size={18} />
              <span>{report.title}</span>
            </button>
          ))}
        </nav>
        <div
          className="sidebar-resizer"
          role="separator"
          aria-orientation="vertical"
          title="拖动调整菜单宽度"
          onMouseDown={(event) => {
            event.preventDefault();
            startSidebarResize(event.clientX, sidebarWidth);
          }}
        />
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
          {openTabs.includes("home") && (
            <div className={`workspace-tab-panel ${activeView === "home" ? "active" : ""}`}>
              <HomePage
                databaseCount={databases.length}
                reportCount={reports.length}
                onOpenView={openView}
                showManagementEntries={showManagementEntries}
              />
            </div>
          )}
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
      <ManagementShortcutAccessDialog
        open={showManagementPasswordPrompt}
        onClose={() => setShowManagementPasswordPrompt(false)}
        onSuccess={() => {
          setShowManagementEntries(true);
          setShowManagementPasswordPrompt(false);
        }}
      />
    </div>
  );
}

function HomePage({
  databaseCount,
  reportCount,
  onOpenView,
  showManagementEntries,
}: {
  databaseCount: number;
  reportCount: number;
  onOpenView: (view: string) => void;
  showManagementEntries: boolean;
}) {
  return (
    <section className="page home-page">
      <div className="home-hero">
        <div>
          <h1>欢迎使用</h1>
          <p>在这里打开已配置的报表，并在同一工作台中维护数据库连接和报表配置。</p>
        </div>
        <div className="home-actions">
          {showManagementEntries && (
            <>
              <button onClick={() => onOpenView("reports")}>
                <Settings size={16} />
                报表管理
              </button>
              <button className="secondary" onClick={() => onOpenView("databases")}>
                <Database size={16} />
                数据库管理
              </button>
            </>
          )}
        </div>
      </div>

      <div className="home-summary">
        <div>
          <span>数据库连接</span>
          <strong>{databaseCount}</strong>
        </div>
        <div>
          <span>已配置报表</span>
          <strong>{reportCount}</strong>
        </div>
      </div>
    </section>
  );
}

function ManagementShortcutAccessDialog({
  open,
  onClose,
  onSuccess,
}: {
  open: boolean;
  onClose: () => void;
  onSuccess: () => void;
}) {
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");

  useEffect(() => {
    if (!open) {
      setPassword("");
      setError("");
    }
  }, [open]);

  if (!open) {
    return null;
  }

  function submit() {
    if (password === managementPassword) {
      onSuccess();
      return;
    }
    setError("密码错误，无法显示管理入口。");
  }

  return (
    <div className="management-password-overlay" onClick={onClose}>
      <div className="access-card" onClick={(event) => event.stopPropagation()}>
        <div className="access-icon">
          <Settings size={22} />
        </div>
        <h2>显示管理入口</h2>
        <p>按快捷键后需要先验证密码，验证通过才会显示数据库管理和报表管理入口。</p>
        <label>
          管理密码
          <input
            type="password"
            value={password}
            onChange={(event) => {
              setPassword(event.target.value);
              if (error) setError("");
            }}
            onKeyDown={(event) => {
              if (event.key === "Enter") {
                event.preventDefault();
                submit();
              }
            }}
            placeholder="请输入密码"
            autoFocus
          />
        </label>
        {error && <Notice tone="bad" text={error} />}
        <div className="access-actions">
          <button className="secondary" onClick={onClose}>
            取消
          </button>
          <button onClick={submit}>
            <Settings size={16} />
            验证并显示
          </button>
        </div>
      </div>
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
  const [saveMessage, setSaveMessage] = useState("");

  function save(payload = draft) {
    if (!payload.name || !payload.host || !payload.database || !payload.username) {
      setSaveMessage("请填写连接名称、主机地址、数据库名和登录账号后再保存。");
      return;
    }
    const next = { ...payload, id: payload.id || crypto.randomUUID() };
    onChange((current) => {
      const exists = current.some((db) => db.id === next.id);
      return exists ? current.map((db) => (db.id === next.id ? next : db)) : [next, ...current];
    });
    setDraft(emptyDatabase);
    setSaveMessage("");
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
          {saveMessage && <Notice tone="warn" text={saveMessage} />}
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
  const [drilldownViewQueries, setDrilldownViewQueries] = useState<Record<string, string>>({});
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
    const incomingByField = new Map(toFilters(incoming).map((filter) => [filter.paramName, filter]));
    if (!existing) return Array.from(incomingByField.values());

    return existing.flatMap((saved) => {
      const filter = incomingByField.get(saved.paramName);
      if (!filter) return [];
      return {
        ...filter,
        label: saved.label || filter.label,
        control: saved.control || filter.control,
        defaultValue: saved.defaultValue ?? filter.defaultValue,
        visible: saved.visible ?? true,
        optionValues: saved.optionValues?.length ? saved.optionValues : filter.optionValues,
      };
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
      visible: true,
      optionValues: viewField?.optionValues || [],
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

  function updateColumn(field: string, patch: Partial<ColumnConfig>) {
    setColumns((current) => current.map((column) => (column.field === field ? { ...column, ...patch } : column)));
  }

  function toggleDrilldown(column: ColumnConfig, checked: boolean) {
    const selectedViewKey = selectedView ? getViewKey(selectedView) : "";
    const viewKeys = views.map((view) => getViewKey(view));
    const fallbackViewKey = viewKeys.find((key) => key !== selectedViewKey) ?? viewKeys[0] ?? "";
    updateColumn(column.field, {
      drilldownEnabled: checked,
      drilldownViewKey: checked ? column.drilldownViewKey || fallbackViewKey : "",
    });
  }

  function updateDrilldownViewQuery(field: string, value: string) {
    setDrilldownViewQueries((current) => ({ ...current, [field]: value }));
  }

  function getDrilldownViewOptions(column: ColumnConfig) {
    const queryText = (drilldownViewQueries[column.field] || "").trim().toLowerCase();
    const filteredViews = queryText
      ? views.filter((view) => {
          const text = `${getViewKey(view)} ${view.description || ""}`.toLowerCase();
          return text.includes(queryText);
        })
      : views;
    if (!column.drilldownViewKey || filteredViews.some((view) => getViewKey(view) === column.drilldownViewKey)) {
      return filteredViews;
    }
    const selectedDrilldownView = views.find((view) => getViewKey(view) === column.drilldownViewKey);
    return selectedDrilldownView ? [selectedDrilldownView, ...filteredViews] : filteredViews;
  }

  function save() {
    if (!title || !databaseId || !selectedView) return;
    const sameSource = initialReport?.databaseId === databaseId && initialReport.viewKey === getViewKey(selectedView);
    const normalizedColumns = columns.map((column) =>
      column.drilldownEnabled ? column : { ...column, drilldownEnabled: false, drilldownViewKey: "" },
    );
    onSave({
      id: initialReport?.id ?? crypto.randomUUID(),
      title,
      databaseId,
      viewKey: getViewKey(selectedView),
      filters,
      columns: normalizedColumns,
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
                <span>下穿</span>
                <span>下穿视图</span>
              </div>
              {columns.map((column) => {
                const filter = filters.find((item) => item.paramName === column.field);
                const filterEnabled = Boolean(filter);
                const drilldownViewOptions = getDrilldownViewOptions(column);
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
                    <label className="table-check">
                      <input type="checkbox" checked={Boolean(column.drilldownEnabled)} onChange={(event) => toggleDrilldown(column, event.target.checked)} />
                    </label>
                    <div className="drilldown-view-picker">
                      <input
                        disabled={!column.drilldownEnabled}
                        value={drilldownViewQueries[column.field] || ""}
                        onChange={(event) => updateDrilldownViewQuery(column.field, event.target.value)}
                        placeholder="筛选视图"
                      />
                      <select
                        disabled={!column.drilldownEnabled}
                        value={column.drilldownViewKey || ""}
                        onChange={(event) => updateColumn(column.field, { drilldownViewKey: event.target.value })}
                      >
                        <option value="">选择视图</option>
                        {drilldownViewOptions.map((view) => {
                          const key = getViewKey(view);
                          return (
                            <option key={key} value={key}>
                              {key}
                            </option>
                          );
                        })}
                      </select>
                    </div>
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
  const [showFilters, setShowFilters] = useState(false);
  const [showColumns, setShowColumns] = useState(false);
  const [filterValues, setFilterValues] = useState<Record<string, string>>(() => buildFilterDefaults(report.filters, report.savedFilterValues));
  const [rows, setRows] = useState<DataRow[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [filterSaveMessage, setFilterSaveMessage] = useState("");
  const [maxRows, setMaxRows] = useState<number | null>(null);
  const [draggedColumnField, setDraggedColumnField] = useState<string | null>(null);
  const [draggedFilterParamName, setDraggedFilterParamName] = useState<string | null>(null);
  const [hasQueried, setHasQueried] = useState(false);
  const [drilldownResult, setDrilldownResult] = useState<DrilldownResult | null>(null);
  const [drilldownSortField, setDrilldownSortField] = useState("");
  const [drilldownSortDirection, setDrilldownSortDirection] = useState<SortDirection>("asc");
  const filterMenuRef = useRef<HTMLDivElement>(null);
  const columnMenuRef = useRef<HTMLDivElement>(null);
  const visibleFilters = report.filters.filter((filter) => filter.visible !== false);

  useEffect(() => {
    const missingOptionFilters = report.filters.filter((filter) => filter.control === "select" && !(filter.optionValues || []).length);
    if (!database || missingOptionFilters.length === 0) {
      return;
    }

    let cancelled = false;

    async function hydrateMissingFilterOptions() {
      try {
        const view = parseViewKey(report.viewKey);
        const result = await apiPost<ApiViewMetadataResult>("/views/metadata", {
          database,
          view,
        });

        if (cancelled) {
          return;
        }

        const optionValuesByField = new Map((result.filters || []).map((filter) => [filter.name, filter.optionValues || []]));
        onUpdate((current) => ({
          ...current,
          filters: current.filters.map((filter) => {
            if (filter.control !== "select" || (filter.optionValues || []).length) {
              return filter;
            }
            return {
              ...filter,
              optionValues: optionValuesByField.get(filter.paramName) || [],
            };
          }),
        }));
      } catch {
        // Keep the existing report configuration when metadata refresh fails.
      }
    }

    void hydrateMissingFilterOptions();

    return () => {
      cancelled = true;
    };
  }, [database, onUpdate, report.filters, report.viewKey]);

  const activeRows = drilldownResult?.rows ?? rows;
  const activeColumns = drilldownResult?.columns ?? report.columns;
  const activeMaxRows = drilldownResult?.maxRows ?? maxRows;
  const activeSortField = drilldownResult ? drilldownSortField : report.sortField;
  const activeSortDirection = drilldownResult ? drilldownSortDirection : report.sortDirection;
  const visibleColumns = activeColumns
    .map((column, index) => ({
      ...column,
      widthCustomized: column.widthCustomized ?? Boolean(column.width && column.width !== defaultColumnWidth(index)),
    }))
    .filter((column) => column.visible);
  const hasCustomColumnWidth = visibleColumns.some((column) => column.widthCustomized);
  const sortedRows = useMemo(() => {
    if (!activeSortField) return activeRows;
    return [...activeRows].sort((left, right) => compareValues(left[activeSortField], right[activeSortField], activeSortDirection));
  }, [activeRows, activeSortField, activeSortDirection]);
  const pageCount = Math.max(1, Math.ceil(sortedRows.length / report.pageSize));
  const pageRows = sortedRows.slice((page - 1) * report.pageSize, page * report.pageSize);
  const tableWidth = hasCustomColumnWidth ? 56 + visibleColumns.reduce((total, column) => total + column.width, 0) : undefined;
  const summaryColumns = visibleColumns.filter((column) => column.type === "number" || column.type === "currency");
  const columnTotals = useMemo(
    () =>
      Object.fromEntries(
        summaryColumns.map((column) => [column.field, getColumnTotal(sortedRows, column.field)]),
      ),
    [sortedRows, summaryColumns],
  );

  useEffect(() => {
    const defaults = buildFilterDefaults(report.filters, report.savedFilterValues);
    setFilterValues(defaults);
    setRows([]);
    setPage(1);
    setHasQueried(false);
    setMaxRows(null);
    setDrilldownResult(null);
    setDrilldownSortField("");
    setDrilldownSortDirection("asc");
    setError("");
    setFilterSaveMessage("");
  }, [report.id]);

  useEffect(() => {
    if (!filterSaveMessage) return;
    const timer = window.setTimeout(() => setFilterSaveMessage(""), 2400);
    return () => window.clearTimeout(timer);
  }, [filterSaveMessage]);

  useEffect(() => {
    setPage(1);
  }, [report.pageSize, activeSortField, activeSortDirection, activeRows.length]);

  useEffect(() => {
    if (!showFilters) return;
    function closeFilterMenu(event: MouseEvent) {
      if (filterMenuRef.current && !filterMenuRef.current.contains(event.target as Node)) {
        setShowFilters(false);
      }
    }
    document.addEventListener("mousedown", closeFilterMenu);
    return () => document.removeEventListener("mousedown", closeFilterMenu);
  }, [showFilters]);

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

  function updateFilterVisibility(paramName: string, visible: boolean) {
    onUpdate((current) => {
      const target = current.filters.find((filter) => filter.paramName === paramName);
      if (!target) return current;
      return {
        ...current,
        filters: current.filters.map((filter) => (filter.paramName === paramName ? { ...filter, visible } : filter)),
      };
    });
  }

  function reorderFilter(sourceParamName: string, targetParamName: string) {
    if (sourceParamName === targetParamName) return;
    onUpdate((current) => {
      const index = current.filters.findIndex((filter) => filter.paramName === sourceParamName);
      const targetIndex = current.filters.findIndex((filter) => filter.paramName === targetParamName);
      if (index < 0 || targetIndex < 0) return current;
      const nextFilters = [...current.filters];
      const [moved] = nextFilters.splice(index, 1);
      nextFilters.splice(targetIndex, 0, moved);
      return { ...current, filters: nextFilters };
    });
  }

  function updateFilterValue(key: string, value: string) {
    setFilterSaveMessage("");
    setFilterValues((current) => ({ ...current, [key]: value }));
  }

  function updateDatePreset(filter: FilterConfig, preset: DateRangePreset) {
    setFilterSaveMessage("");
    setFilterValues((current) => {
      const next = {
        ...current,
        [`${filter.paramName}__preset`]: preset,
      };
      if (!preset) return next;
      const range = getDatePresetRange(preset);
      return {
        ...next,
        [`${filter.paramName}__start`]: range.start,
        [`${filter.paramName}__end`]: range.end,
      };
    });
  }

  function updateDateRangeValue(filter: FilterConfig, key: "start" | "end", value: string) {
    setFilterSaveMessage("");
    setFilterValues((current) => ({
      ...current,
      [`${filter.paramName}__preset`]: "",
      [`${filter.paramName}__${key}`]: value,
    }));
  }

  function saveCurrentFilters() {
    const valuesToSave = resolveDatePresetValues(filterValues, report.filters);
    setFilterValues(valuesToSave);
    onUpdate((current) => ({
      ...current,
      savedFilterValues: buildSavedFilterValues(current.filters, valuesToSave),
    }));
    setFilterSaveMessage("查询条件已保存，下次打开报表会自动带出。");
  }

  function clearFilterValue(filter: FilterConfig) {
    setFilterSaveMessage("");
    if (filter.control === "date") {
      setFilterValues((current) => ({
        ...current,
        [`${filter.paramName}__preset`]: "",
        [`${filter.paramName}__start`]: "",
        [`${filter.paramName}__end`]: "",
      }));
      return;
    }
    updateFilterValue(filter.paramName, "");
  }

  function clearVisibleFilters() {
    setFilterSaveMessage("");
    setFilterValues((current) => {
      const next = { ...current };
      visibleFilters.forEach((filter) => {
        if (filter.control === "date") {
          next[`${filter.paramName}__preset`] = "";
          next[`${filter.paramName}__start`] = "";
          next[`${filter.paramName}__end`] = "";
          return;
        }
        next[filter.paramName] = "";
      });
      return next;
    });
  }

  function hasFilterValue(filter: FilterConfig) {
    if (filter.control === "date") {
      return Boolean(filterValues[`${filter.paramName}__preset`] || filterValues[`${filter.paramName}__start`] || filterValues[`${filter.paramName}__end`]);
    }
    return Boolean(filterValues[filter.paramName]);
  }

  function openDatePicker(input: HTMLInputElement) {
    try {
      input.showPicker?.();
    } catch {
      input.focus();
    }
  }

  function handleFilterKeyDown(event: ReactKeyboardEvent) {
    if (event.key !== "Enter" || loading) return;
    const target = event.target as HTMLElement;
    if (target.tagName !== "INPUT") return;
    event.preventDefault();
    void runQuery();
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

  function getDrilldownControl(column: ColumnConfig): FilterControl {
    const sqlType = (column.sqlType || "").toLowerCase();
    if (column.type === "date" || sqlType.includes("date") || sqlType.includes("time")) return "date";
    return "select";
  }

  async function runDrilldown(column: ColumnConfig, value: DataValue) {
    if (!database) {
      setError("当前报表关联的数据库不存在，请在报表管理中重新配置。");
      return;
    }
    if (!column.drilldownEnabled || !column.drilldownViewKey) return;
    if (value === "" || value === null || value === undefined) {
      setError("空值不能下穿查询。");
      return;
    }

    setLoading(true);
    setError("");
    try {
      const result = await apiPost<ApiQueryResult>("/views/query", {
        database,
        view: parseViewKey(column.drilldownViewKey),
        maxRows: 10000,
        filters: [
          {
            field: column.field,
            sqlType: column.sqlType || "",
            control: getDrilldownControl(column),
            value,
          },
        ],
      });
      const incomingColumns = normalizeColumns(result.columns?.length ? result.columns : columnsFromRows(result.rows || []));
      setDrilldownResult({
        viewKey: column.drilldownViewKey,
        sourceField: column.field,
        sourceLabel: column.label || column.field,
        sourceSqlType: column.sqlType || "",
        sourceType: column.type,
        value,
        rows: result.rows || [],
        columns: incomingColumns,
        maxRows: result.maxRows || null,
      });
      setDrilldownSortField(incomingColumns[0]?.field ?? "");
      setDrilldownSortDirection("asc");
      setHasQueried(true);
      setPage(1);
    } catch (queryError) {
      setError(queryError instanceof Error ? queryError.message : "下穿查询数据库视图失败");
    } finally {
      setLoading(false);
    }
  }

  function refreshCurrentData() {
    if (!drilldownResult) {
      void runQuery();
      return;
    }
    void runDrilldown(
      {
        field: drilldownResult.sourceField,
        label: drilldownResult.sourceLabel,
        sqlType: drilldownResult.sourceSqlType,
        type: drilldownResult.sourceType,
        visible: true,
        width: defaultColumnWidth(0),
        drilldownEnabled: true,
        drilldownViewKey: drilldownResult.viewKey,
      },
      drilldownResult.value,
    );
  }

  async function runQuery(values = filterValues) {
    if (!database) {
      setError("当前报表关联的数据库不存在，请在报表管理中重新配置。");
      return;
    }
    const queryValues = resolveDatePresetValues(values, visibleFilters);
    if (queryValues !== values) {
      setFilterValues(queryValues);
    }
    setLoading(true);
    setHasQueried(true);
    setDrilldownResult(null);
    setError("");
    try {
      const result = await apiPost<ApiQueryResult>("/views/query", {
        database,
        view: parseViewKey(report.viewKey),
        maxRows: 10000,
        filters: visibleFilters.map((filter) => ({
          field: filter.paramName,
          sqlType: filter.sqlType,
          control: filter.control,
          value:
            filter.control === "date"
              ? {
                  start: queryValues[`${filter.paramName}__start`] ?? "",
                  end: queryValues[`${filter.paramName}__end`] ?? "",
                }
              : queryValues[filter.paramName] ?? "",
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

  function getReportStatusText() {
    if (drilldownResult) {
      return `${drilldownResult.sourceLabel} = ${formatValue(drilldownResult.value, drilldownResult.sourceType)}`;
    }
    if (loading) return "正在查询数据库视图...";
    if (!hasQueried) return visibleFilters.length > 0 ? "设置筛选条件后点击查询" : "当前报表无筛选条件，可直接查询全部数据";
    if (activeMaxRows && sortedRows.length >= activeMaxRows) return `已查询 ${sortedRows.length} 条，达到本次最多 ${activeMaxRows} 条`;
    return `已查询 ${sortedRows.length} 条`;
  }

  return (
    <section className="page report-query-page">
      <div className={`filter-band ${expanded ? "expanded" : ""}`} onKeyDown={handleFilterKeyDown}>
        <div className="filter-row">
          {visibleFilters.map((filter) => {
            const filled = hasFilterValue(filter);
            if (filter.control === "date") {
              const startKey = `${filter.paramName}__start`;
              const endKey = `${filter.paramName}__end`;
              const presetKey = `${filter.paramName}__preset`;
              return (
                <div className="filter-control date-range-control" key={filter.paramName}>
                  <span className="filter-label-text">{filter.label}</span>
                  <div className="date-range-inputs">
                    <select
                      className="date-preset-select"
                      value={filterValues[presetKey] ?? ""}
                      onChange={(event) => updateDatePreset(filter, event.target.value as DateRangePreset)}
                    >
                      {dateRangePresets.map((preset) => (
                        <option key={preset.value || "custom"} value={preset.value}>
                          {preset.label}
                        </option>
                      ))}
                    </select>
                    <input
                      className={filterValues[startKey] ? undefined : "empty-date-input"}
                      type="date"
                      value={filterValues[startKey] ?? ""}
                      onClick={(event) => openDatePicker(event.currentTarget)}
                      onChange={(event) => updateDateRangeValue(filter, "start", event.target.value)}
                    />
                    <span>至</span>
                    <input
                      className={filterValues[endKey] ? undefined : "empty-date-input"}
                      type="date"
                      value={filterValues[endKey] ?? ""}
                      onClick={(event) => openDatePicker(event.currentTarget)}
                      onChange={(event) => updateDateRangeValue(filter, "end", event.target.value)}
                    />
                    <button className="clear-filter-button" type="button" title="清空" onClick={() => clearFilterValue(filter)} disabled={!filled}>
                      <X size={14} />
                    </button>
                  </div>
                </div>
              );
            }
            return (
              <div className="filter-control" key={filter.paramName}>
                <span className="filter-label-text">{filter.label}</span>
                <div className="filter-input-wrap">
                  {filter.control === "select" ? (
                    <select value={filterValues[filter.paramName] ?? ""} onChange={(event) => updateFilterValue(filter.paramName, event.target.value)}>
                      <option value="">全部</option>
                      {(filter.optionValues || []).map((option) => (
                        <option key={option} value={option}>
                          {option}
                        </option>
                      ))}
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
                      onChange={(event) => updateFilterValue(filter.paramName, event.target.value)}
                    />
                  )}
                  <button className="clear-filter-button" type="button" title="清空" onClick={() => clearFilterValue(filter)} disabled={!filled}>
                    <X size={14} />
                  </button>
                </div>
              </div>
            );
          })}
        </div>
        <div className="filter-actions">
          <div className={`filter-menu ${showFilters ? "menu-open" : ""}`} ref={filterMenuRef}>
            <button className="secondary icon-action-button" title="筛选条件设置" onClick={() => setShowFilters(!showFilters)} disabled={report.filters.length === 0}>
              <Settings size={16} />
            </button>
            {showFilters && (
              <div className="column-popover filter-popover">
                <div className="column-popover-head">筛选条件顺序</div>
                {report.filters.map((filter, index) => (
                  <div
                    className={`column-order-row ${draggedFilterParamName === filter.paramName ? "dragging" : ""}`}
                    draggable
                    key={filter.paramName}
                    onDragStart={(event) => {
                      event.dataTransfer.effectAllowed = "move";
                      event.dataTransfer.setData("text/plain", filter.paramName);
                      setDraggedFilterParamName(filter.paramName);
                    }}
                    onDragOver={(event) => {
                      event.preventDefault();
                      event.dataTransfer.dropEffect = "move";
                    }}
                    onDrop={(event) => {
                      event.preventDefault();
                      const sourceParamName = event.dataTransfer.getData("text/plain") || draggedFilterParamName;
                      if (sourceParamName) reorderFilter(sourceParamName, filter.paramName);
                      setDraggedFilterParamName(null);
                    }}
                    onDragEnd={() => setDraggedFilterParamName(null)}
                  >
                    <GripVertical className="drag-handle" size={16} />
                    <label>
                      <input
                        type="checkbox"
                        checked={filter.visible !== false}
                        onChange={(event) => updateFilterVisibility(filter.paramName, event.target.checked)}
                      />
                      <span title={filter.label}>
                        {index + 1}. {filter.label}
                      </span>
                    </label>
                  </div>
                ))}
              </div>
            )}
          </div>
          <button className="secondary icon-action-button save-filter-button" type="button" title="保存查询条件" onClick={saveCurrentFilters} disabled={report.filters.length === 0}>
            <Save size={16} />
          </button>
          <button className="query-button" onClick={() => void runQuery()} disabled={loading}>
            {loading ? <LoaderCircle className="spin" size={16} /> : <Search size={16} />}
            查询
          </button>
        </div>
        {visibleFilters.length > 0 && (
          <div className="filter-more-actions">
            <button type="button" onClick={clearVisibleFilters}>
              清空
            </button>
            <button type="button" onClick={() => setExpanded(!expanded)}>
              {expanded ? "收起" : "更多"}
              {expanded ? <ChevronUp size={14} /> : <ChevronDown size={14} />}
            </button>
          </div>
        )}
      </div>

      {filterSaveMessage && <Notice tone="ok" text={filterSaveMessage} />}
      {error && <Notice tone="bad" text={error} />}

      <div className="data-panel">
        <div className="table-toolbar">
          <div>
            <strong>{drilldownResult ? `下穿视图：${displayViewName(drilldownResult.viewKey)}` : report.title}</strong>
            <span>{getReportStatusText()}</span>
          </div>
          <div className="table-actions">
            {drilldownResult && (
              <button className="secondary" onClick={() => setDrilldownResult(null)}>
                返回上层
              </button>
            )}
            <label className="merged-control sort-field">
              <span className="filter-label-text">排序</span>
              <select
                value={activeSortField}
                onChange={(event) => {
                  if (drilldownResult) {
                    setDrilldownSortField(event.target.value);
                    return;
                  }
                  onUpdate((current) => ({ ...current, sortField: event.target.value }));
                }}
              >
                {visibleColumns.map((column) => (
                  <option key={column.field} value={column.field}>
                    {column.label}
                  </option>
                ))}
              </select>
            </label>
            <button
              className="secondary"
              onClick={() => {
                if (drilldownResult) {
                  setDrilldownSortDirection((current) => (current === "asc" ? "desc" : "asc"));
                  return;
                }
                onUpdate((current) => ({ ...current, sortDirection: current.sortDirection === "asc" ? "desc" : "asc" }));
              }}
            >
              <SlidersHorizontal size={16} />
              {activeSortDirection === "asc" ? "升序" : "降序"}
            </button>
            <button className="secondary" onClick={refreshCurrentData} disabled={loading}>
              <RefreshCw size={16} />
              刷新
            </button>
            <button className="secondary" onClick={exportCurrentData} disabled={!hasQueried || sortedRows.length === 0}>
              <Download size={16} />
              导出
            </button>
            {!drilldownResult && (
              <div className={`column-menu ${showColumns ? "menu-open" : ""}`} ref={columnMenuRef}>
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
            )}
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
                    {visibleColumns.map((column) => {
                      const value = row[column.field];
                      const displayValue = formatValue(value, column.type);
                      const canDrilldown = !drilldownResult && column.drilldownEnabled && column.drilldownViewKey && value !== "" && value !== null && value !== undefined;
                      return (
                        <td key={column.field} style={column.widthCustomized ? { width: column.width, maxWidth: column.width } : undefined}>
                          {canDrilldown ? (
                            <button className="drilldown-cell-button" type="button" onClick={() => void runDrilldown(column, value)}>
                              {displayValue}
                            </button>
                          ) : column.type === "status" ? (
                            <span className="tag">{displayValue}</span>
                          ) : (
                            displayValue
                          )}
                        </td>
                      );
                    })}
                  </tr>
                ))}
              </tbody>
              {summaryColumns.length > 0 && (
                <tfoot>
                  <tr className="summary-row">
                    <td className="row-number-cell summary-label-cell">合计</td>
                    {visibleColumns.map((column) => (
                      <td key={column.field} style={column.widthCustomized ? { width: column.width, maxWidth: column.width } : undefined}>
                        {column.type === "number" || column.type === "currency" ? formatValue(columnTotals[column.field] ?? 0, column.type) : ""}
                      </td>
                    ))}
                  </tr>
                </tfoot>
              )}
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
            共 {sortedRows.length} 条{activeMaxRows && sortedRows.length >= activeMaxRows ? `，最多显示 ${activeMaxRows} 条` : ""}
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

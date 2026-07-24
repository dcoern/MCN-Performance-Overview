/* =========================================================================
   SHEET-CONFIG.JS
   Menghubungkan dashboard ke Google Sheet (tanpa API key, tanpa backend).
   Cara kerja: memakai endpoint publik Google Visualization ("gviz") yang bisa
   dibaca langsung oleh browser selama sheet di-share "Anyone with the link".

   ------------------------------------------------------------------------
   LANGKAH SETUP (sekali saja)
   ------------------------------------------------------------------------
   1. Buka Google Sheet kamu (pakai template kolom di bawah / file
      template-gsheet.csv yang sudah disediakan).
   2. Klik "Share" -> ubah akses jadi "Anyone with the link" -> role "Viewer".
      (Kalau tetap "Restricted", endpoint ini tidak akan bisa membaca datanya.)
   3. Ambil SPREADSHEET_ID dari URL sheet:
        https://docs.google.com/spreadsheets/d/  >>>SPREADSHEET_ID<<<  /edit
   4. Isi SHEET_CONFIG.spreadsheetId di bawah ini dengan ID tersebut.
   5. Isi SHEET_CONFIG.sheetName dengan nama tab sheet-nya (default "Sheet1").
   6. Pastikan header kolom di baris pertama sheet PERSIS seperti daftar di
      bawah (urutan kolom bebas, tapi nama header harus sama).
   7. Pastikan kolom angka diformat sebagai NUMBER di Google Sheets, bukan Text.

   ------------------------------------------------------------------------
   TEMPLATE KOLOM (header wajib, urutan bebas)
   ------------------------------------------------------------------------
   Period | Group Channel | Group Unit Business | Target | MTD Target |
   Estimated Revenue (IDR) | Estimated Closing (IDR)

   Catatan penting soal kolom "Period" (BARU — untuk fitur MoM/QoQ/YoY):
   - Format wajib: "YYYY-MM", contoh "2026-07" untuk Juli 2026.
   - Satu baris = satu Group Unit Business PADA SATU PERIODE (bulan) tertentu.
     Artinya kalau kamu punya 19 unit bisnis dan ingin simpan 13 bulan riwayat
     (untuk YoY penuh), sheet akan berisi 19 x 13 = 247 baris. Ini normal.
   - Dashboard otomatis mendeteksi periode TERBARU di sheet sebagai "periode
     berjalan" (current period), lalu menghitung:
       MoM = periode berjalan vs 1 bulan sebelumnya
       QoQ = quarter-to-date berjalan vs periode yang sama di quarter sebelumnya
       YoY = periode berjalan vs bulan yang sama tahun sebelumnya
     berbasis metrik "Estimated Closing".
   - Kalau kolom "Period" tidak ada / tidak diisi, dashboard tetap jalan
     normal untuk tampilan utama, tapi kartu perbandingan MoM/QoQ/YoY akan
     menampilkan "data historis belum tersedia" karena tidak ada bulan lain
     untuk dibandingkan.
   - Kalau mau paksa periode berjalan tertentu (bukan otomatis yang terbaru),
     isi SHEET_CONFIG.currentPeriod di bawah, misal "2026-07".

   Catatan lain (sama seperti sebelumnya):
   - Baris "Total" per channel TIDAK perlu dibuat manual — dihitung otomatis.
   - Kolom persentase (MTD %, Achievement %, Gap MTD %) juga dihitung otomatis:
       MTD %        = Estimated Revenue / MTD Target        x 100
       Achievement % = Estimated Revenue / Target             x 100
       Gap MTD %     = MTD % - 100
   ========================================================================= */

const SHEET_CONFIG = {
  // Wajib diisi: ID spreadsheet (lihat langkah 3 di atas)
  spreadsheetId: "PASTE_SPREADSHEET_ID_DI_SINI",

  // Nama tab/sheet yang berisi data. Kosongkan gid jika pakai ini.
  sheetName: "Sheet1",

  // Alternatif: gid tab (angka di URL setelah #gid=). Kosongkan ("") jika tidak dipakai.
  gid: "",

  // Auto-refresh data setiap sekian menit. Set 0 untuk mematikan auto-refresh.
  autoRefreshMinutes: 5,

  // Paksa periode berjalan tertentu, format "YYYY-MM". Kosongkan ("") untuk
  // otomatis memakai periode terbaru yang ada di kolom Period.
  currentPeriod: "",

  // Nama-nama header kolom di sheet.
  columns: {
    period: "Period",
    groupChannel: "Group Channel",
    groupUnitBusiness: "Group Unit Business",
    target: "Target",
    mtdTarget: "MTD Target",
    estimatedRevenue: "Estimated Revenue (IDR)",
    estimatedClosing: "Estimated Closing (IDR)",
  },

  // Warna per Group Channel (siklus terus kalau channel di sheet lebih banyak).
  channelColorPalette: ["#F87171", "#FBBF24", "#22D3EE", "#34D399", "#A78BFA", "#F472B6"],
};

/* =========================================================================
   Tidak perlu diubah di bawah ini kecuali struktur sheet berubah drastis.
   ========================================================================= */

const REQUIRED_COLUMN_KEYS = [
  "groupChannel", "groupUnitBusiness", "target", "mtdTarget",
  "estimatedRevenue", "estimatedClosing",
];

function _normalizeHeader(str) {
  return String(str || "").toLowerCase().replace(/[^a-z0-9]/g, "");
}

function _toNumber(v) {
  if (v === null || v === undefined || v === "") return 0;
  if (typeof v === "number") return v;
  const cleaned = String(v).replace(/[^0-9.\-]/g, "");
  const n = parseFloat(cleaned);
  return isNaN(n) ? 0 : n;
}

function _buildSheetUrl(config) {
  const base = `https://docs.google.com/spreadsheets/d/${config.spreadsheetId}/gviz/tq?tqx=out:json`;
  if (config.gid !== undefined && config.gid !== null && String(config.gid).trim() !== "") {
    return `${base}&gid=${encodeURIComponent(config.gid)}`;
  }
  return `${base}&sheet=${encodeURIComponent(config.sheetName || "Sheet1")}`;
}

/* ---------- Helper aritmatika periode "YYYY-MM" (dipakai juga oleh dashboard) ---------- */
function parsePeriod(p) {
  const [y, m] = String(p).split("-").map(Number);
  return { y, m };
}
function periodKey(y, m) {
  return `${y}-${String(m).padStart(2, "0")}`;
}
function shiftMonth(period, delta) {
  let { y, m } = parsePeriod(period);
  m += delta;
  while (m < 1) { m += 12; y--; }
  while (m > 12) { m -= 12; y++; }
  return periodKey(y, m);
}
/** Bulan-bulan dari awal quarter s.d. periode ini (quarter-to-date). */
function quarterMonthsToDate(period) {
  const { y, m } = parsePeriod(period);
  const qStartMonth = Math.floor((m - 1) / 3) * 3 + 1;
  const months = [];
  for (let mm = qStartMonth; mm <= m; mm++) months.push(periodKey(y, mm));
  return months;
}
/** Bulan-bulan yang sepadan di quarter sebelumnya (jumlah bulan sama). */
function priorQuarterMonthsToDate(period) {
  return quarterMonthsToDate(period).map((p) => shiftMonth(p, -3));
}
const ID_MONTHS = ["Jan","Feb","Mar","Apr","Mei","Jun","Jul","Agu","Sep","Okt","Nov","Des"];
function formatPeriodLabel(period) {
  const { y, m } = parsePeriod(period);
  return `${ID_MONTHS[m - 1]} ${y}`;
}

/**
 * Ambil data mentah dari Google Sheet -> array of row objects
 * { period, groupChannel, groupUnitBusiness, target, mtdTarget, estimatedRevenue, estimatedClosing }
 */
async function fetchSheetRows(config = SHEET_CONFIG) {
  if (!config.spreadsheetId || config.spreadsheetId.includes("PASTE_SPREADSHEET_ID")) {
    throw new Error("SHEET_CONFIG.spreadsheetId belum diisi. Lihat komentar di sheet-config.js.");
  }

  const url = _buildSheetUrl(config);
  const res = await fetch(url);
  if (!res.ok) {
    throw new Error(`Gagal mengambil sheet (HTTP ${res.status}). Pastikan sheet di-share "Anyone with the link".`);
  }

  const text = await res.text();
  const match = text.match(/google\.visualization\.Query\.setResponse\(([\s\S]*)\);?\s*$/);
  if (!match) {
    throw new Error("Format respons Google Sheet tidak dikenali. Cek apakah spreadsheetId/sheetName benar dan sheet-nya publik.");
  }

  let json;
  try {
    json = JSON.parse(match[1]);
  } catch (e) {
    throw new Error("Gagal parse JSON dari Google Sheet: " + e.message);
  }

  if (json.status === "error") {
    const msg = (json.errors && json.errors[0] && json.errors[0].detailed_message) || "Sheet/tab tidak ditemukan.";
    throw new Error("Google Sheet error: " + msg);
  }

  const cols = json.table.cols.map((c) => _normalizeHeader(c.label));
  const colIndex = {};
  Object.entries(config.columns).forEach(([key, headerLabel]) => {
    colIndex[key] = cols.indexOf(_normalizeHeader(headerLabel));
  });

  const missing = REQUIRED_COLUMN_KEYS.filter((key) => colIndex[key] === -1).map((key) => config.columns[key]);
  if (missing.length) {
    throw new Error("Kolom berikut tidak ditemukan di sheet: " + missing.join(", "));
  }

  const hasPeriodColumn = colIndex.period !== undefined && colIndex.period !== -1;

  const rows = json.table.rows
    .map((row) => {
      const cell = (key) => (row.c[colIndex[key]] ? row.c[colIndex[key]].v : null);
      const rawPeriod = hasPeriodColumn ? String(cell("period") || "").trim() : "";
      return {
        period: rawPeriod || (config.currentPeriod || "current"),
        groupChannel: String(cell("groupChannel") || "").trim(),
        groupUnitBusiness: String(cell("groupUnitBusiness") || "").trim(),
        target: _toNumber(cell("target")),
        mtdTarget: _toNumber(cell("mtdTarget")),
        estimatedRevenue: _toNumber(cell("estimatedRevenue")),
        estimatedClosing: _toNumber(cell("estimatedClosing")),
      };
    })
    .filter((r) => r.groupChannel !== "" || r.groupUnitBusiness !== "");

  if (!rows.length) {
    throw new Error("Sheet berhasil dibuka tapi tidak ada baris data yang valid.");
  }

  return rows;
}

function _computePercents(target, mtdTarget, actual) {
  const mtdPct = mtdTarget !== 0 ? (actual / mtdTarget) * 100 : 0;
  const achPct = target !== 0 ? (actual / target) * 100 : 0;
  const gapPct = mtdTarget !== 0 ? mtdPct - 100 : 0;
  return { mtdPct, achPct, gapPct };
}

/**
 * Ubah rows (SATU periode saja, sudah difilter) -> { DATA, GRAND } yang
 * dipakai langsung oleh dashboard.
 */
function buildDashboardData(rows, config = SHEET_CONFIG) {
  const channelOrder = [];
  const channelMap = new Map();

  rows.forEach((r) => {
    if (!channelMap.has(r.groupChannel)) {
      channelMap.set(r.groupChannel, []);
      channelOrder.push(r.groupChannel);
    }
    const { mtdPct, achPct, gapPct } = _computePercents(r.target, r.mtdTarget, r.estimatedRevenue);
    channelMap.get(r.groupChannel).push({
      name: r.groupUnitBusiness,
      target: r.target,
      mtdTarget: r.mtdTarget,
      actual: r.estimatedRevenue,
      closing: r.estimatedClosing,
      mtdPct, achPct, gapPct,
    });
  });

  const sumUnits = (units, key) => units.reduce((s, u) => s + u[key], 0);

  const DATA = channelOrder.map((name, i) => {
    const units = channelMap.get(name);
    const target = sumUnits(units, "target");
    const mtdTarget = sumUnits(units, "mtdTarget");
    const actual = sumUnits(units, "actual");
    const closing = sumUnits(units, "closing");
    const { mtdPct, achPct, gapPct } = _computePercents(target, mtdTarget, actual);
    return {
      name,
      color: config.channelColorPalette[i % config.channelColorPalette.length],
      total: { target, mtdTarget, actual, closing, mtdPct, achPct, gapPct },
      units,
    };
  });

  const grandTarget = DATA.reduce((s, c) => s + c.total.target, 0);
  const grandMtdTarget = DATA.reduce((s, c) => s + c.total.mtdTarget, 0);
  const grandActual = DATA.reduce((s, c) => s + c.total.actual, 0);
  const grandClosing = DATA.reduce((s, c) => s + c.total.closing, 0);
  const grandPct = _computePercents(grandTarget, grandMtdTarget, grandActual);

  const GRAND = { target: grandTarget, mtdTarget: grandMtdTarget, actual: grandActual, closing: grandClosing, ...grandPct };

  return { DATA, GRAND };
}

/**
 * Kelompokkan rows multi-periode -> { periodsIndex, currentPeriod }
 * periodsIndex[period] = { DATA, GRAND } (lihat buildDashboardData).
 */
function buildPeriodsIndex(rows, config = SHEET_CONFIG) {
  const byPeriod = new Map();
  rows.forEach((r) => {
    if (!byPeriod.has(r.period)) byPeriod.set(r.period, []);
    byPeriod.get(r.period).push(r);
  });

  const periodsIndex = {};
  byPeriod.forEach((periodRows, period) => {
    periodsIndex[period] = buildDashboardData(periodRows, config);
  });

  const allPeriods = Array.from(byPeriod.keys()).sort(); // "YYYY-MM" sorts correctly as string
  const currentPeriod = (config.currentPeriod && periodsIndex[config.currentPeriod])
    ? config.currentPeriod
    : allPeriods[allPeriods.length - 1];

  return { periodsIndex, currentPeriod, allPeriods };
}

/** Fungsi siap-pakai: fetch + transform + kelompokkan per periode sekaligus. */
async function loadDashboardDataFromSheet(config = SHEET_CONFIG) {
  const rows = await fetchSheetRows(config);
  const { periodsIndex, currentPeriod, allPeriods } = buildPeriodsIndex(rows, config);
  const current = periodsIndex[currentPeriod];
  return { DATA: current.DATA, GRAND: current.GRAND, periodsIndex, currentPeriod, allPeriods };
}

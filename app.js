// ======================================================
// Salon Earnings Tracker – Firebase v10 modular SDK (CDN)
// ======================================================
import { initializeApp } from "https://www.gstatic.com/firebasejs/10.12.2/firebase-app.js";
import {
  getFirestore, doc, collection, onSnapshot, setDoc, deleteField, arrayUnion, arrayRemove
} from "https://www.gstatic.com/firebasejs/10.12.2/firebase-firestore.js";

// ---------- Firebase setup ----------
const firebaseConfig = {
  apiKey: "AIzaSyBuHtGMJrwNlFXIqJhT0ntYnd3Ti0gQy0",
  authDomain: "hair-salon-cf9ca.firebaseapp.com",
  projectId: "hair-salon-cf9ca",
  storageBucket: "hair-salon-cf9ca.firebasestorage.app",
  messagingSenderId: "721305547470",
  appId: "1:721305547470:web:40833955d2c0941328169f",
  measurementId: "G-ZNKBQZY25B"
};
const app = initializeApp(firebaseConfig);
const db = getFirestore(app);

// ---------- Date helpers (all LOCAL time, never toISOString, to avoid timezone bugs) ----------
const pad = n => String(n).padStart(2, "0");
const toKey = d => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
const fromKey = key => { const [y, m, d] = key.split("-").map(Number); return new Date(y, m - 1, d); };

// Monday of the week containing the given date (Sunday counts as the END of the week)
function weekStart(date) {
  const d = new Date(date.getFullYear(), date.getMonth(), date.getDate());
  const offset = (d.getDay() + 6) % 7;     // Mon=0 ... Sun=6
  d.setDate(d.getDate() - offset);
  return d;
}
const addDays = (d, n) => { const x = new Date(d); x.setDate(x.getDate() + n); return x; };

const money = n => Number(n).toLocaleString(undefined, { maximumFractionDigits: 2 });
const prettyDate = key =>
  fromKey(key).toLocaleDateString(undefined, { weekday: "short", day: "numeric", month: "short" });

// ---------- DOM ----------
const $ = id => document.getElementById(id);
const dateInput = $("dateInput"), amountInput = $("amountInput");
const saveBtn = $("saveBtn"), deleteBtn = $("deleteBtn"), formTitle = $("formTitle"), message = $("message");

// ---------- State ----------
const today = new Date();
let viewedWeek = toKey(weekStart(today));  // week shown in totals/entries
let weekDays = {};                         // { "YYYY-MM-DD": amount } for the viewed week
let unsubscribeWeek = null;
let unsubscribeStock = null;

// ======================================================
// 1) Real-time listener for the viewed week
// ======================================================
function listenToWeek(weekKey) {
  if (unsubscribeWeek) unsubscribeWeek();    // stop listening to the previous week
  unsubscribeWeek = onSnapshot(doc(db, "weeks", weekKey), snap => {
    weekDays = snap.exists() ? (snap.data().days || {}) : {};
    renderTotals();
    renderEntries();
    syncForm();
  }, err => showMessage("Could not load data. Check your internet.", true));
}

// ======================================================
// 2) Totals: Mon–Fri, Mon–Sat, Mon–Sun
// ======================================================
function sumFirstDays(count) {
  const start = fromKey(viewedWeek);
  let total = 0;
  for (let i = 0; i < count; i++) total += Number(weekDays[toKey(addDays(start, i))] || 0);
  return total;
}
function renderTotals() {
  $("totalFri").textContent = money(sumFirstDays(5));
  $("totalSat").textContent = money(sumFirstDays(6));
  $("totalSun").textContent = money(sumFirstDays(7));
}

function renderWeekLabel() {
  const start = fromKey(viewedWeek), end = addDays(start, 6);
  const fmt = d => d.toLocaleDateString(undefined, { day: "numeric", month: "short" });
  const isCurrent = viewedWeek === toKey(weekStart(today));
  $("weekLabel").textContent = `${isCurrent ? "This week: " : ""}${fmt(start)} – ${fmt(end)}`;
}

// ======================================================
// 3) Entries list (click a row to edit it)
// ======================================================
function renderEntries() {
  const list = $("entryList");
  list.innerHTML = "";
  const keys = Object.keys(weekDays).sort();
  $("emptyEntries").hidden = keys.length > 0;

  keys.forEach(key => {
    const li = document.createElement("li");

    const row = document.createElement("button");
    row.className = "entry-btn" + (key === dateInput.value ? " active" : "");
    row.innerHTML = `<span class="entry-date">${prettyDate(key)}</span>
                     <span class="entry-amount">${money(weekDays[key])}</span>`;
    row.addEventListener("click", () => { dateInput.value = key; syncForm(); });

    const del = document.createElement("button");
    del.className = "del-btn";
    del.textContent = "Delete";
    del.setAttribute("aria-label", `Delete ${prettyDate(key)}`);
    del.addEventListener("click", () => deleteEntry(key));

    li.append(row, del);
    list.appendChild(li);
  });
}

// ======================================================
// 4) Form: add / edit / delete
// ======================================================
// If the chosen date already has an amount, load it for editing.
function syncForm() {
  const key = dateInput.value;
  const existing = key && viewedWeekKeyOf(key) === viewedWeek ? weekDays[key] : undefined;
  if (existing !== undefined) {
    amountInput.value = existing;
    saveBtn.textContent = "Save changes";
    formTitle.textContent = "Edit earnings";
    deleteBtn.hidden = false;
  } else {
    // keep whatever is typed if the user is mid-entry, otherwise clear
    if (document.activeElement !== amountInput && saveBtn.textContent === "Save changes") amountInput.value = "";
    saveBtn.textContent = "Add";
    formTitle.textContent = "Add earnings";
    deleteBtn.hidden = true;
  }
  renderEntries();
}
const viewedWeekKeyOf = key => toKey(weekStart(fromKey(key)));

// When the date picker changes, jump to that date's week and reload the form.
dateInput.addEventListener("change", () => {
  if (!dateInput.value) return;
  amountInput.value = "";
  const wk = viewedWeekKeyOf(dateInput.value);
  if (wk !== viewedWeek) changeWeek(wk);   // listener will call syncForm()
  else syncForm();
});

saveBtn.addEventListener("click", async () => {
  const key = dateInput.value;
  const amount = parseFloat(amountInput.value);
  if (!key) return showMessage("Please pick a date.", true);
  if (isNaN(amount) || amount < 0) return showMessage("Please enter an amount.", true);

  try {
    // Doc ID = Monday of that date's week. merge:true keeps the other days untouched.
    await setDoc(doc(db, "weeks", viewedWeekKeyOf(key)), { days: { [key]: amount } }, { merge: true });
    showMessage("Saved ✓");
    amountInput.value = "";
    saveBtn.textContent = "Add";           // syncForm will reload the saved amount via snapshot
  } catch (e) {
    showMessage("Could not save. Try again.", true);
  }
});

deleteBtn.addEventListener("click", () => deleteEntry(dateInput.value));

async function deleteEntry(key) {
  if (!key || !confirm(`Delete the entry for ${prettyDate(key)}?`)) return;
  try {
    // deleteField() removes just that one date from the "days" map
    await setDoc(doc(db, "weeks", viewedWeekKeyOf(key)), { days: { [key]: deleteField() } }, { merge: true });
    if (dateInput.value === key) amountInput.value = "";
    showMessage("Deleted ✓");
  } catch (e) {
    showMessage("Could not delete. Try again.", true);
  }
}

function showMessage(text, isError = false) {
  message.textContent = text;
  message.className = "message" + (isError ? " error" : "");
  clearTimeout(showMessage.t);
  showMessage.t = setTimeout(() => (message.textContent = ""), 3000);
}

// ======================================================
// 5) Week navigation
// ======================================================
function changeWeek(weekKey) {
  viewedWeek = weekKey;
  renderWeekLabel();
  listenToWeek(weekKey);
}
$("prevWeek").addEventListener("click", () => {
  const wk = toKey(addDays(fromKey(viewedWeek), -7));
  dateInput.value = wk; amountInput.value = ""; changeWeek(wk);
});
$("nextWeek").addEventListener("click", () => {
  const wk = toKey(addDays(fromKey(viewedWeek), 7));
  dateInput.value = wk; amountInput.value = ""; changeWeek(wk);
});

// ======================================================
// 6) Sunday stock flow (only visible on Sundays)
//    Saved in the CURRENT week's doc (the week that ends today).
// ======================================================
const isSunday = today.getDay() === 0;
const currentWeekKey = toKey(weekStart(today));

if (isSunday) {
  $("stockSection").hidden = false;

  unsubscribeStock = onSnapshot(doc(db, "weeks", currentWeekKey), snap => {
    const items = snap.exists() ? (snap.data().stock || []) : [];
    const list = $("stockList");
    list.innerHTML = "";
    $("emptyStock").hidden = items.length > 0;

    items.forEach(item => {
      const li = document.createElement("li");
      const name = document.createElement("span");
      name.textContent = item;
      const del = document.createElement("button");
      del.className = "del-btn";
      del.textContent = "Delete";
      del.setAttribute("aria-label", `Delete ${item}`);
      del.addEventListener("click", () =>
        setDoc(doc(db, "weeks", currentWeekKey), { stock: arrayRemove(item) }, { merge: true }));
      li.append(name, del);
      list.appendChild(li);
    });
  });

  const addStock = async () => {
    const input = $("stockInput");
    const item = input.value.trim();
    if (!item) return;
    input.value = "";
    await setDoc(doc(db, "weeks", currentWeekKey), { stock: arrayUnion(item) }, { merge: true });
    input.focus();
  };
  $("stockAddBtn").addEventListener("click", addStock);
  $("stockInput").addEventListener("keydown", e => { if (e.key === "Enter") addStock(); });
}

// ======================================================
// Start
// ======================================================
dateInput.value = toKey(today);   // default to today
renderWeekLabel();
listenToWeek(viewedWeek);


// ======================================================
// 7) HISTORY: listen to ALL weeks (newest first, includes stock)
// ======================================================
let allWeeks = {};   // { "2025-01-13": { days: {...}, stock: [...] }, ... }

onSnapshot(collection(db, "weeks"), snap => {
  allWeeks = {};
  snap.forEach(d => (allWeeks[d.id] = d.data()));
  renderHistory();
}, () => showMessage("Could not load history.", true));

// Escape text before putting it into innerHTML (stock names are user-typed)
const esc = s => String(s).replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));

// Sum the first `count` days of a week (1..7) from a days map
function sumDays(days, weekId, count) {
  const start = fromKey(weekId);
  let t = 0;
  for (let i = 0; i < count; i++) t += Number(days[toKey(addDays(start, i))] || 0);
  return t;
}

function renderHistory() {
  const box = $("historyList");
  box.innerHTML = "";
  const ids = Object.keys(allWeeks).sort().reverse();
  $("emptyHistory").hidden = ids.length > 0;

  const fmt = d => d.toLocaleDateString(undefined, { day: "numeric", month: "short" });

  ids.forEach(id => {
    const { days = {}, stock = [] } = allWeeks[id];
    const start = fromKey(id), end = addDays(start, 6);
    const dayKeys = Object.keys(days).sort();

    const earningsHtml = dayKeys.length
      ? `<ul class="mini">${dayKeys.map(k =>
          `<li><span>${esc(prettyDate(k))}</span><strong>${money(days[k])}</strong></li>`).join("")}</ul>`
      : `<p class="mini-empty">No earnings saved.</p>`;

    const stockHtml = stock.length
      ? `<ul class="mini">${stock.map(s => `<li><span>${esc(s)}</span></li>`).join("")}</ul>`
      : `<p class="mini-empty">No stock saved.</p>`;

    const el = document.createElement("details");
    el.className = "week-item";
    el.innerHTML = `
      <summary><span>${fmt(start)} – ${fmt(end)}</span><span class="sum">${money(sumDays(days, id, 7))}</span></summary>
      <div class="week-body">
        <h3>Earnings</h3>${earningsHtml}
        <div class="mini-totals">
          <span>Mon–Fri <strong>${money(sumDays(days, id, 5))}</strong></span>
          <span>Mon–Sat <strong>${money(sumDays(days, id, 6))}</strong></span>
          <span>Mon–Sun <strong>${money(sumDays(days, id, 7))}</strong></span>
        </div>
        <h3>Stock</h3>${stockHtml}
      </div>`;
    box.appendChild(el);
  });
}

// ======================================================
// 8) EXPORT: CSV and Excel, for the viewed week or a month
// ======================================================
const exportType = $("exportType"), monthInput = $("monthInput");
monthInput.value = `${today.getFullYear()}-${pad(today.getMonth() + 1)}`;
exportType.addEventListener("change", () => ($("monthField").hidden = exportType.value !== "month"));

const dayName = key => fromKey(key).toLocaleDateString("en-US", { weekday: "long" });

// Build the rows for the chosen range. Returns { name, earnings: [[...]], stock: [[...]] }
function buildExport() {
  const isMonth = exportType.value === "month";
  const month = monthInput.value;                       // "YYYY-MM"
  const inRange = key => isMonth ? key.startsWith(month) : weekIdOf(key) === viewedWeek;
  const weekIdOf = viewedWeekKeyOf;

  // Earnings rows
  const entries = [];
  Object.values(allWeeks).forEach(w => Object.entries(w.days || {}).forEach(([k, v]) => {
    if (inRange(k)) entries.push([k, Number(v)]);
  }));
  entries.sort((x, y) => x[0].localeCompare(y[0]));

  const earnings = [["Date", "Day", "Amount"], ...entries.map(([k, v]) => [k, dayName(k), v])];
  const total = entries.reduce((s, e) => s + e[1], 0);
  earnings.push([], ["Total", "", total]);

  if (!isMonth) {                                       // weekly sub-totals
    const days = (allWeeks[viewedWeek] || {}).days || {};
    earnings.push(["Mon–Fri", "", sumDays(days, viewedWeek, 5)], ["Mon–Sat", "", sumDays(days, viewedWeek, 6)]);
  }

  // Stock rows: every week that touches the chosen range
  const stock = [["Week starting", "Item"]];
  Object.keys(allWeeks).sort().forEach(id => {
    const touches = isMonth
      ? id.startsWith(month) || toKey(addDays(fromKey(id), 6)).startsWith(month)
      : id === viewedWeek;
    if (touches) (allWeeks[id].stock || []).forEach(item => stock.push([id, item]));
  });

  return { name: isMonth ? `salon-${month}` : `salon-week-${viewedWeek}`, earnings, stock };
}

function downloadBlob(blob, filename) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url; a.download = filename;
  document.body.appendChild(a); a.click(); a.remove();
  URL.revokeObjectURL(url);
}
const csvCell = v => `"${String(v).replace(/"/g, '""')}"`;
const toCsv = rows => rows.map(r => r.map(csvCell).join(",")).join("\r\n");

$("csvBtn").addEventListener("click", () => {
  const { name, earnings, stock } = buildExport();
  // "\uFEFF" (BOM) makes Excel read accents/symbols correctly
  const text = "\uFEFF" + toCsv(earnings) + "\r\n\r\n" + toCsv(stock);
  downloadBlob(new Blob([text], { type: "text/csv;charset=utf-8" }), name + ".csv");
});

$("xlsxBtn").addEventListener("click", () => {
  if (!window.XLSX) return showMessage("Excel library did not load. Try CSV.", true);
  const { name, earnings, stock } = buildExport();
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(earnings), "Earnings");
  XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(stock), "Stock");
  XLSX.writeFile(wb, name + ".xlsx");
});

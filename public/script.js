let trades = [];
let filteredTrades = [];
let plChart, cumulativeChart, pieChart, timeSeriesChart;
let currentPage = 1;
const pageSize = 50;

const tradeForm = document.getElementById('tradeForm');
const tradeTable = document.getElementById('tradeTable').getElementsByTagName('tbody')[0];

// ---------- Auth Helper ----------
function authFetch(url, options = {}) {
  const token = localStorage.getItem("token");
  if (!token) {
    alert("Session expired. Please login again.");
    window.location.href = "/login.html";
    return;
  }
  return fetch(url, {
    ...options,
    headers: {
      "Content-Type": "application/json",
      Authorization: "Bearer " + token,
      ...(options.headers || {})
    }
  });
}

function logout() {
  localStorage.removeItem("token");
  localStorage.removeItem("email");
  window.location.href = "/login.html";
}

// ---------- Load Trades ----------
window.onload = loadTrades;

async function loadTrades() {
  const res = await authFetch("/api/trades");
  if (!res) return;
  trades = await res.json();
  filteredTrades = [...trades];
  currentPage = 1;
  renderTrades();
  updateCharts();
  updateSummary();
}

// ---------- Render Trades ----------
function renderTrades() {
  tradeTable.innerHTML = "";

  const start = (currentPage - 1) * pageSize;
  const end = start + pageSize;
  const paginated = filteredTrades.slice(start, end);

  paginated.forEach(t => {
    const row = tradeTable.insertRow();
    row.innerHTML = `
      <td>${t.trade_date}</td>
      <td>${t.symbol}</td>
      <td>${t.strike_price}</td>
      <td>${t.option_type}</td>
      <td>${t.quantity}</td>
      <td>${parseFloat(t.buy_price).toFixed(2)}</td>
      <td>${parseFloat(t.sell_price).toFixed(2)}</td>
      <td class="${t.pl >= 0 ? 'profit' : 'loss'}">${parseFloat(t.pl).toFixed(2)}</td>
      <td class="${t.return_pct >= 0 ? 'profit' : 'loss'}">${parseFloat(t.return_pct).toFixed(2)}%</td>
      <td class="actions">
        <button class="edit" onclick="editTrade(${t.id})">Edit</button>
        <button class="delete" onclick="deleteTrade(${t.id})">Delete</button>
      </td>
    `;
  });

  document.getElementById("pageInfo").innerText =
    `Page ${currentPage} of ${Math.ceil(filteredTrades.length / pageSize)}`;
}

function nextPage() {
  if (currentPage * pageSize < filteredTrades.length) {
    currentPage++;
    renderTrades();
  }
}

function prevPage() {
  if (currentPage > 1) {
    currentPage--;
    renderTrades();
  }
}

// ---------- CRUD ----------
tradeForm.addEventListener('submit', async (e) => {
  e.preventDefault();
  const tradeId = document.getElementById('tradeId').value;
  const date = document.getElementById('date').value;
  const symbol = document.getElementById('symbol').value;
  const strikePrice = parseFloat(document.getElementById('strikePrice').value);
  const optionType = document.getElementById('optionType').value;
  const quantity = parseInt(document.getElementById('quantity').value);
  const buyPrice = parseFloat(document.getElementById('buyPrice').value);
  const sellPrice = parseFloat(document.getElementById('sellPrice').value);

  const pl = (sellPrice - buyPrice) * quantity;
  const returnPct = ((sellPrice - buyPrice) / buyPrice * 100).toFixed(2);

  const trade = { date, symbol, strikePrice, optionType, quantity, buyPrice, sellPrice, pl, returnPct };

  if (tradeId) {
    await authFetch(`/api/trades/${tradeId}`, {
      method: "PUT",
      body: JSON.stringify(trade)
    });
  } else {
    await authFetch("/api/trades", {
      method: "POST",
      body: JSON.stringify(trade)
    });
  }

  await loadTrades();
  resetForm();
});

function editTrade(id) {
  const t = trades.find(trade => trade.id === id);
  document.getElementById('tradeId').value = t.id;
  document.getElementById('date').value = t.trade_date.split("T")[0];
  document.getElementById('symbol').value = t.symbol;
  document.getElementById('strikePrice').value = t.strike_price;
  document.getElementById('optionType').value = t.option_type;
  document.getElementById('quantity').value = t.quantity;
  document.getElementById('buyPrice').value = t.buy_price;
  document.getElementById('sellPrice').value = t.sell_price;
}

async function deleteTrade(id) {
  if (!confirm("Delete this trade?")) return;
  await authFetch(`/api/trades/${id}`, { method: "DELETE" });
  await loadTrades();
}

function resetForm() {
  tradeForm.reset();
  document.getElementById('tradeId').value = "";
}

// ---------- Filters ----------
function filterRange(days) {
  if (days === 'all') {
    filteredTrades = [...trades];
  } else {
    const cutoff = new Date();
    cutoff.setDate(cutoff.getDate() - parseInt(days));
    filteredTrades = trades.filter(t => new Date(t.trade_date) >= cutoff);
  }
  currentPage = 1;
  renderTrades();
  updateCharts();
  updateSummary();
}

function applyCustomRange() {
  const from = document.getElementById("customFrom").value;
  const to = document.getElementById("customTo").value;
  if (!from || !to) {
    alert("Select both from and to dates");
    return;
  }
  const fromDate = new Date(from);
  const toDate = new Date(to);
  filteredTrades = trades.filter(t => {
    const d = new Date(t.trade_date);
    return d >= fromDate && d <= toDate;
  });
  currentPage = 1;
  renderTrades();
  updateCharts();
  updateSummary();
}

// ---------- Charts ----------
function updateCharts() {
  const labels = filteredTrades.map((t, i) => `Trade ${i+1} (${t.symbol})`);
  const plData = filteredTrades.map(t => parseFloat(t.pl));
  let runningTotal = 0;
  const cumulativeData = filteredTrades.map(t => runningTotal += parseFloat(t.pl));

  // Bar
  if (plChart) plChart.destroy();
  plChart = new Chart(document.getElementById('plChart'), {
    type: 'bar',
    data: { labels, datasets: [{ label: 'Profit/Loss', data: plData,
      backgroundColor: plData.map(v => v >= 0 ? 'rgba(40,167,69,0.6)' : 'rgba(220,53,69,0.6)'),
      borderColor: plData.map(v => v >= 0 ? 'green' : 'red'), borderWidth: 1 }] },
    options: { responsive: true, plugins: { legend: { display: false } }, scales: { y: { beginAtZero: true } } }
  });

  // Cumulative
  if (cumulativeChart) cumulativeChart.destroy();
  cumulativeChart = new Chart(document.getElementById('cumulativeChart'), {
    type: 'line',
    data: { labels, datasets: [{ label: 'Cumulative P/L', data: cumulativeData, borderColor: 'blue',
      backgroundColor: 'rgba(0,123,255,0.2)', fill: true, tension: 0.2 }] },
    options: { responsive: true, scales: { y: { beginAtZero: true } } }
  });

  // Pie
  const profits = filteredTrades.filter(t => t.pl > 0).reduce((s, t) => s + parseFloat(t.pl), 0);
  const losses = filteredTrades.filter(t => t.pl < 0).reduce((s, t) => s + Math.abs(parseFloat(t.pl)), 0);
  if (pieChart) pieChart.destroy();
  pieChart = new Chart(document.getElementById('pieChart'), {
    type: 'pie',
    data: { labels: ['Profit', 'Loss'], datasets: [{ data: [profits, losses],
      backgroundColor: ['rgba(40,167,69,0.6)', 'rgba(220,53,69,0.6)'],
      borderColor: ['green', 'red'], borderWidth: 1 }] },
    options: { responsive: true }
  });

  // Time Series
  const sortedTrades = [...filteredTrades].sort((a, b) => new Date(a.trade_date) - new Date(b.trade_date));
  const tsLabels = sortedTrades.map(t => t.trade_date);
  const tsPL = sortedTrades.map(t => parseFloat(t.pl));
  if (timeSeriesChart) timeSeriesChart.destroy();
  timeSeriesChart = new Chart(document.getElementById('timeSeriesChart'), {
    type: 'line',
    data: { labels: tsLabels, datasets: [{
      label: 'Profit/Loss Over Time',
      data: tsPL,
      borderColor: 'purple',
      backgroundColor: 'rgba(128,0,128,0.2)',
      fill: true, tension: 0.2
    }] },
    options: {
      responsive: true,
      plugins: { legend: { display: true } },
      scales: {
        x: { type: 'time', time: { unit: 'day' }, title: { display: true, text: 'Date' } },
        y: { beginAtZero: true, title: { display: true, text: 'P/L' } }
      }
    }
  });
}

// ---------- Summary ----------
function updateSummary() {
  const totalTrades = filteredTrades.length;
  const wins = filteredTrades.filter(t => t.pl > 0).length;
  const totalPL = filteredTrades.reduce((sum, t) => sum + parseFloat(t.pl), 0);
  const avgReturn = filteredTrades.length > 0 ? (filteredTrades.reduce((sum, t) => sum + parseFloat(t.return_pct), 0) / filteredTrades.length).toFixed(2) : 0;
  const winRate = filteredTrades.length > 0 ? ((wins / filteredTrades.length) * 100).toFixed(2) : 0;

  document.getElementById('totalTrades').innerText = totalTrades;
  document.getElementById('winRate').innerText = winRate + "%";
  document.getElementById('avgReturn').innerText = avgReturn + "%";
  document.getElementById('totalPL').innerText = totalPL.toFixed(2);
}

// ---------- Export CSV ----------
function exportCSV() {
  if (filteredTrades.length === 0) { alert("No trades to export!"); return; }
  let csv = "Date,Symbol,Strike,Type,Quantity,Buy Price,Sell Price,P/L,Return %\n";
  filteredTrades.forEach(t => {
    csv += `${t.trade_date},${t.symbol},${t.strike_price},${t.option_type},${t.quantity},${t.buy_price},${t.sell_price},${t.pl},${t.return_pct}%\n`;
  });

  const profits = filteredTrades.filter(t => t.pl > 0).reduce((s, t) => s + parseFloat(t.pl), 0);
  const losses = filteredTrades.filter(t => t.pl < 0).reduce((s, t) => s + Math.abs(parseFloat(t.pl)), 0);
  csv += `\nSummary\nTotal Trades,${filteredTrades.length}\nTotal Profit,${profits}\nTotal Loss,${losses}\n`;

  const sortedTrades = [...filteredTrades].sort((a, b) => new Date(a.trade_date) - new Date(b.trade_date));
  csv += `\nTime Series (Date vs P/L)\n`;
  sortedTrades.forEach(t => { csv += `${t.trade_date},${t.pl}\n`; });

  const blob = new Blob([csv], { type: 'text/csv' });
  const url = window.URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url; a.download = 'trade_log.csv'; a.click();
}

// ---------- See All ----------
function openAllTrades() {
  let html = `
    <html>
      <head>
        <title>All Trades</title>
        <style>
          body { font-family: Arial; margin: 20px; }
          table { width: 100%; border-collapse: collapse; }
          th, td { border: 1px solid #ddd; padding: 8px; text-align: center; }
          th { background: #007bff; color: white; }
          .profit { color: green; }
          .loss { color: red; }
        </style>
      </head>
      <body>
        <h2>All Trades</h2>
        <table>
          <thead>
            <tr>
              <th>Date</th><th>Symbol</th><th>Strike</th><th>Type</th>
              <th>Quantity</th><th>Buy Price</th><th>Sell Price</th>
              <th>P/L</th><th>Return %</th>
            </tr>
          </thead>
          <tbody>
  `;

  filteredTrades.forEach(t => {
    html += `
      <tr>
        <td>${t.trade_date}</td>
        <td>${t.symbol}</td>
        <td>${t.strike_price}</td>
        <td>${t.option_type}</td>
        <td>${t.quantity}</td>
        <td>${parseFloat(t.buy_price).toFixed(2)}</td>
        <td>${parseFloat(t.sell_price).toFixed(2)}</td>
        <td class="${t.pl >= 0 ? 'profit' : 'loss'}">${parseFloat(t.pl).toFixed(2)}</td>
        <td class="${t.return_pct >= 0 ? 'profit' : 'loss'}">${parseFloat(t.return_pct).toFixed(2)}%</td>
      </tr>
    `;
  });

  html += `</tbody></table></body></html>`;
  const newWindow = window.open("", "_blank");
  newWindow.document.write(html);
  newWindow.document.close();
}

let trades = [];
let filteredTrades = [];
let plChart, cumulativeChart, pieChart, timeSeriesChart;
let currentPage = 1;
const pageSize = 20;

const tradeForm = document.getElementById('tradeForm');
const tradeTable = document.getElementById('tradeTable').getElementsByTagName('tbody')[0];

// ---------- Auth Helper ----------
function authFetch(url, options = {}) {
  const token = localStorage.getItem("token");
  if (!token) {
    showNotification("Session expired. Please login again.", "error");
    setTimeout(() => {
      window.location.href = "/login.html";
    }, 2000);
    return Promise.reject("No token");
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
  showNotification("Logged out successfully", "success");
  setTimeout(() => {
    window.location.href = "/login.html";
  }, 1000);
}

// ---------- Notifications ----------
function showNotification(message, type = "info") {
  // Remove existing notifications
  const existing = document.querySelector('.notification');
  if (existing) existing.remove();

  const notification = document.createElement('div');
  notification.className = `notification notification-${type}`;
  notification.style.cssText = `
    position: fixed;
    top: 20px;
    right: 20px;
    padding: 15px 20px;
    border-radius: 10px;
    color: white;
    font-weight: 500;
    z-index: 1000;
    animation: slideIn 0.3s ease;
    max-width: 300px;
    box-shadow: 0 4px 12px rgba(0,0,0,0.15);
  `;

  const colors = {
    success: '#28a745',
    error: '#dc3545',
    warning: '#ffc107',
    info: '#17a2b8'
  };

  notification.style.background = colors[type] || colors.info;
  notification.textContent = message;

  document.body.appendChild(notification);

  setTimeout(() => {
    notification.style.animation = 'slideOut 0.3s ease';
    setTimeout(() => notification.remove(), 300);
  }, 3000);
}

// Add CSS for animations
const style = document.createElement('style');
style.textContent = `
  @keyframes slideIn {
    from { transform: translateX(100%); opacity: 0; }
    to { transform: translateX(0); opacity: 1; }
  }
  @keyframes slideOut {
    from { transform: translateX(0); opacity: 1; }
    to { transform: translateX(100%); opacity: 0; }
  }
`;
document.head.appendChild(style);

// ---------- Initialize ----------
window.onload = async function() {
  // Check authentication
  const token = localStorage.getItem("token");
  const email = localStorage.getItem("email");
  
  if (!token) {
    window.location.href = "/login.html";
    return;
  }

  // Display user email
  document.getElementById("userEmail").textContent = email || "User";

  // Set default date to today
  document.getElementById('date').valueAsDate = new Date();

  // Load trades
  await loadTrades();
  
  showNotification("Welcome back! Dashboard loaded successfully.", "success");
};

// ---------- Load Trades ----------
async function loadTrades() {
  try {
    showLoading(true);
    const res = await authFetch("/api/trades");
    trades = await res.json();
    filteredTrades = [...trades];
    currentPage = 1;
    renderTrades();
    updateCharts();
    updateSummary();
    showLoading(false);
  } catch (error) {
    console.error("Error loading trades:", error);
    showNotification("Error loading trades. Please try again.", "error");
    showLoading(false);
  }
}

function showLoading(show) {
  const tbody = tradeTable;
  if (show) {
    tbody.innerHTML = `
      <tr>
        <td colspan="10" class="loading">
          <div class="spinner"></div>
        </td>
      </tr>
    `;
  }
}

// ---------- Render Trades ----------
function renderTrades() {
  tradeTable.innerHTML = "";

  if (filteredTrades.length === 0) {
    tradeTable.innerHTML = `
      <tr>
        <td colspan="10" style="padding: 40px; text-align: center; color: #666;">
          <i class="fas fa-inbox" style="font-size: 3rem; margin-bottom: 15px; display: block;"></i>
          No trades found. Add your first trade above!
        </td>
      </tr>
    `;
    document.getElementById("pageInfo").textContent = "No trades";
    return;
  }

  const start = (currentPage - 1) * pageSize;
  const end = start + pageSize;
  const paginated = filteredTrades.slice(start, end);

  paginated.forEach(t => {
    const row = tradeTable.insertRow();
    const pl = parseFloat(t.pl);
    const returnPct = parseFloat(t.return_pct);
    
    row.innerHTML = `
      <td>${formatDate(t.trade_date)}</td>
      <td><strong>${t.symbol}</strong></td>
      <td>$${parseFloat(t.strike_price).toFixed(2)}</td>
      <td>
        <span class="badge ${t.option_type.toLowerCase()}">${t.option_type}</span>
      </td>
      <td>${t.quantity}</td>
      <td>$${parseFloat(t.buy_price).toFixed(2)}</td>
      <td>$${parseFloat(t.sell_price).toFixed(2)}</td>
      <td class="${pl >= 0 ? 'profit' : 'loss'}">
        <strong>${pl >= 0 ? '+' : ''}$${pl.toFixed(2)}</strong>
      </td>
      <td class="${returnPct >= 0 ? 'profit' : 'loss'}">
        <strong>${returnPct >= 0 ? '+' : ''}${returnPct.toFixed(2)}%</strong>
      </td>
      <td class="actions">
        <button class="btn-warning" onclick="editTrade(${t.id})" title="Edit Trade">
          <i class="fas fa-edit"></i>
        </button>
        <button class="btn-danger" onclick="deleteTrade(${t.id})" title="Delete Trade">
          <i class="fas fa-trash"></i>
        </button>
      </td>
    `;
  });

  const totalPages = Math.ceil(filteredTrades.length / pageSize);
  document.getElementById("pageInfo").textContent = 
    `Page ${currentPage} of ${totalPages} (${filteredTrades.length} trades)`;
}

function formatDate(dateString) {
  const date = new Date(dateString);
  return date.toLocaleDateString('en-US', { 
    month: 'short', 
    day: 'numeric', 
    year: 'numeric' 
  });
}

function nextPage() {
  const totalPages = Math.ceil(filteredTrades.length / pageSize);
  if (currentPage < totalPages) {
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

// ---------- CRUD Operations ----------
tradeForm.addEventListener('submit', async (e) => {
  e.preventDefault();
  
  try {
    const tradeId = document.getElementById('tradeId').value;
    const date = document.getElementById('date').value;
    const symbol = document.getElementById('symbol').value.toUpperCase();
    const strikePrice = parseFloat(document.getElementById('strikePrice').value);
    const optionType = document.getElementById('optionType').value;
    const quantity = parseInt(document.getElementById('quantity').value);
    const buyPrice = parseFloat(document.getElementById('buyPrice').value);
    const sellPrice = parseFloat(document.getElementById('sellPrice').value);

    // Validation
    if (!date || !symbol || !strikePrice || !optionType || !quantity || !buyPrice || !sellPrice) {
      showNotification("Please fill in all fields", "warning");
      return;
    }

    if (quantity <= 0) {
      showNotification("Quantity must be greater than 0", "warning");
      return;
    }

    if (buyPrice <= 0 || sellPrice <= 0) {
      showNotification("Prices must be greater than 0", "warning");
      return;
    }

    const pl = (sellPrice - buyPrice) * quantity;
    const returnPct = ((sellPrice - buyPrice) / buyPrice * 100);

    const trade = { 
      date, 
      symbol, 
      strikePrice, 
      optionType, 
      quantity, 
      buyPrice, 
      sellPrice, 
      pl, 
      returnPct 
    };

    if (tradeId) {
      await authFetch(`/api/trades/${tradeId}`, {
        method: "PUT",
        body: JSON.stringify(trade)
      });
      showNotification("Trade updated successfully!", "success");
    } else {
      await authFetch("/api/trades", {
        method: "POST",
        body: JSON.stringify(trade)
      });
      showNotification("Trade added successfully!", "success");
    }

    await loadTrades();
    resetForm();
  } catch (error) {
    console.error("Error saving trade:", error);
    showNotification("Error saving trade. Please try again.", "error");
  }
});

function editTrade(id) {
  const t = trades.find(trade => trade.id === id);
  if (!t) return;

  document.getElementById('tradeId').value = t.id;
  document.getElementById('date').value = t.trade_date.split("T")[0];
  document.getElementById('symbol').value = t.symbol;
  document.getElementById('strikePrice').value = t.strike_price;
  document.getElementById('optionType').value = t.option_type;
  document.getElementById('quantity').value = t.quantity;
  document.getElementById('buyPrice').value = t.buy_price;
  document.getElementById('sellPrice').value = t.sell_price;

  document.getElementById('formTitleText').textContent = 'Edit Trade';
  document.querySelector('.form-container').scrollIntoView({ behavior: 'smooth' });
  
  showNotification("Trade loaded for editing", "info");
}

async function deleteTrade(id) {
  if (!confirm("Are you sure you want to delete this trade? This action cannot be undone.")) return;
  
  try {
    await authFetch(`/api/trades/${id}`, { method: "DELETE" });
    showNotification("Trade deleted successfully", "success");
    await loadTrades();
  } catch (error) {
    console.error("Error deleting trade:", error);
    showNotification("Error deleting trade. Please try again.", "error");
  }
}

function resetForm() {
  tradeForm.reset();
  document.getElementById('tradeId').value = "";
  document.getElementById('formTitleText').textContent = 'Add New Trade';
  document.getElementById('date').valueAsDate = new Date();
}

// ---------- Filters ----------
function filterRange(days) {
  // Update active filter button
  document.querySelectorAll('.filter-btn').forEach(btn => btn.classList.remove('active'));
  event.target.classList.add('active');

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
  
  showNotification(`Filtered to ${filteredTrades.length} trades`, "info");
}

function applyCustomRange() {
  const from = document.getElementById("customFrom").value;
  const to = document.getElementById("customTo").value;
  
  if (!from || !to) {
    showNotification("Please select both from and to dates", "warning");
    return;
  }

  const fromDate = new Date(from);
  const toDate = new Date(to);
  
  if (fromDate > toDate) {
    showNotification("From date cannot be after to date", "warning");
    return;
  }

  filteredTrades = trades.filter(t => {
    const d = new Date(t.trade_date);
    return d >= fromDate && d <= toDate;
  });
  
  // Remove active class from filter buttons
  document.querySelectorAll('.filter-btn').forEach(btn => btn.classList.remove('active'));
  
  currentPage = 1;
  renderTrades();
  updateCharts();
  updateSummary();
  
  showNotification(`Custom range applied: ${filteredTrades.length} trades`, "info");
}

// ---------- Charts ----------
function updateCharts() {
  if (filteredTrades.length === 0) {
    // Clear charts if no data
    if (plChart) plChart.destroy();
    if (cumulativeChart) cumulativeChart.destroy();
    if (pieChart) pieChart.destroy();
    if (timeSeriesChart) timeSeriesChart.destroy();
    return;
  }

  const labels = filteredTrades.map((t, i) => `${t.symbol} (${formatDate(t.trade_date)})`);
  const plData = filteredTrades.map(t => parseFloat(t.pl));
  
  let runningTotal = 0;
  const cumulativeData = filteredTrades.map(t => runningTotal += parseFloat(t.pl));

  // Individual Trade P/L Chart
  if (plChart) plChart.destroy();
  plChart = new Chart(document.getElementById('plChart'), {
    type: 'bar',
    data: {
      labels,
      datasets: [{
        label: 'Profit/Loss',
        data: plData,
        backgroundColor: plData.map(v => v >= 0 ? 'rgba(40,167,69,0.8)' : 'rgba(220,53,69,0.8)'),
        borderColor: plData.map(v => v >= 0 ? '#28a745' : '#dc3545'),
        borderWidth: 2,
        borderRadius: 4
      }]
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      plugins: {
        legend: { display: false },
        tooltip: {
          callbacks: {
            label: function(context) {
              return `P/L: $${context.parsed.y.toFixed(2)}`;
            }
          }
        }
      },
      scales: {
        y: {
          beginAtZero: true,
          ticks: {
            callback: function(value) {
              return '$' + value.toFixed(0);
            }
          }
        },
        x: {
          ticks: {
            maxRotation: 45,
            minRotation: 45
          }
        }
      }
    }
  });

  // Cumulative P/L Chart
  if (cumulativeChart) cumulativeChart.destroy();
  cumulativeChart = new Chart(document.getElementById('cumulativeChart'), {
    type: 'line',
    data: {
      labels,
      datasets: [{
        label: 'Cumulative P/L',
        data: cumulativeData,
        borderColor: '#667eea',
        backgroundColor: 'rgba(102, 126, 234, 0.1)',
        fill: true,
        tension: 0.4,
        borderWidth: 3,
        pointBackgroundColor: '#667eea',
        pointBorderColor: '#fff',
        pointBorderWidth: 2,
        pointRadius: 5
      }]
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      plugins: {
        tooltip: {
          callbacks: {
            label: function(context) {
              return `Cumulative P/L: $${context.parsed.y.toFixed(2)}`;
            }
          }
        }
      },
      scales: {
        y: {
          beginAtZero: true,
          ticks: {
            callback: function(value) {
              return '$' + value.toFixed(0);
            }
          }
        },
        x: {
          ticks: {
            maxRotation: 45,
            minRotation: 45
          }
        }
      }
    }
  });

  // Profit vs Loss Pie Chart
  const profits = filteredTrades.filter(t => t.pl > 0).reduce((s, t) => s + parseFloat(t.pl), 0);
  const losses = Math.abs(filteredTrades.filter(t => t.pl < 0).reduce((s, t) => s + parseFloat(t.pl), 0));
  
  if (pieChart) pieChart.destroy();
  pieChart = new Chart(document.getElementById('pieChart'), {
    type: 'doughnut',
    data: {
      labels: ['Profits', 'Losses'],
      datasets: [{
        data: [profits, losses],
        backgroundColor: ['rgba(40,167,69,0.8)', 'rgba(220,53,69,0.8)'],
        borderColor: ['#28a745', '#dc3545'],
        borderWidth: 2
      }]
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      plugins: {
        tooltip: {
          callbacks: {
            label: function(context) {
              const total = profits + losses;
              const percentage = total > 0 ? ((context.parsed / total) * 100).toFixed(1) : 0;
              return `${context.label}: $${context.parsed.toFixed(2)} (${percentage}%)`;
            }
          }
        }
      }
    }
  });

  // Time Series Chart
  const sortedTrades = [...filteredTrades].sort((a, b) => new Date(a.trade_date) - new Date(b.trade_date));
  const tsLabels = sortedTrades.map(t => formatDate(t.trade_date));
  const tsPL = sortedTrades.map(t => parseFloat(t.pl));
  
  if (timeSeriesChart) timeSeriesChart.destroy();
  timeSeriesChart = new Chart(document.getElementById('timeSeriesChart'), {
    type: 'line',
    data: {
      labels: tsLabels,
      datasets: [{
        label: 'P/L Over Time',
        data: tsPL,
        borderColor: '#764ba2',
        backgroundColor: 'rgba(118, 75, 162, 0.1)',
        fill: true,
        tension: 0.4,
        borderWidth: 3,
        pointBackgroundColor: tsPL.map(v => v >= 0 ? '#28a745' : '#dc3545'),
        pointBorderColor: '#fff',
        pointBorderWidth: 2,
        pointRadius: 6
      }]
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      plugins: {
        tooltip: {
          callbacks: {
            label: function(context) {
              return `P/L: $${context.parsed.y.toFixed(2)}`;
            }
          }
        }
      },
      scales: {
        y: {
          beginAtZero: true,
          ticks: {
            callback: function(value) {
              return '$' + value.toFixed(0);
            }
          }
        },
        x: {
          ticks: {
            maxRotation: 45,
            minRotation: 45
          }
        }
      }
    }
  });
}

// ---------- Summary Statistics ----------
function updateSummary() {
  const totalTrades = filteredTrades.length;
  const wins = filteredTrades.filter(t => t.pl > 0).length;
  const totalPL = filteredTrades.reduce((sum, t) => sum + parseFloat(t.pl), 0);
  const avgReturn = filteredTrades.length > 0 ? 
    (filteredTrades.reduce((sum, t) => sum + parseFloat(t.return_pct), 0) / filteredTrades.length) : 0;
  const winRate = filteredTrades.length > 0 ? ((wins / filteredTrades.length) * 100) : 0;

  // Update summary cards with animations
  animateValue('totalTrades', totalTrades);
  animateValue('winRate', winRate.toFixed(1) + '%');
  animateValue('avgReturn', (avgReturn >= 0 ? '+' : '') + avgReturn.toFixed(2) + '%');
  animateValue('totalPL', (totalPL >= 0 ? '+$' : '-$') + Math.abs(totalPL).toFixed(2));

  // Update colors based on performance
  const totalPLElement = document.getElementById('totalPL');
  const avgReturnElement = document.getElementById('avgReturn');
  
  totalPLElement.className = totalPL >= 0 ? 'value profit' : 'value loss';
  avgReturnElement.className = avgReturn >= 0 ? 'value profit' : 'value loss';
}

function animateValue(elementId, newValue) {
  const element = document.getElementById(elementId);
  element.style.transform = 'scale(1.1)';
  element.textContent = newValue;
  
  setTimeout(() => {
    element.style.transform = 'scale(1)';
  }, 200);
}

// ---------- Export CSV ----------
function exportCSV() {
  if (filteredTrades.length === 0) {
    showNotification("No trades to export!", "warning");
    return;
  }

  try {
    let csv = "Date,Symbol,Strike Price,Option Type,Quantity,Buy Price,Sell Price,P/L,Return %\n";
    
    filteredTrades.forEach(t => {
      csv += `${t.trade_date},${t.symbol},${t.strike_price},${t.option_type},${t.quantity},${t.buy_price},${t.sell_price},${t.pl},${t.return_pct}\n`;
    });

    // Add summary
    const totalPL = filteredTrades.reduce((sum, t) => sum + parseFloat(t.pl), 0);
    const wins = filteredTrades.filter(t => t.pl > 0).length;
    const winRate = filteredTrades.length > 0 ? ((wins / filteredTrades.length) * 100).toFixed(2) : 0;
    
    csv += `\nSUMMARY\n`;
    csv += `Total Trades,${filteredTrades.length}\n`;
    csv += `Win Rate,${winRate}%\n`;
    csv += `Total P/L,${totalPL.toFixed(2)}\n`;

    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
    const link = document.createElement('a');
    const url = URL.createObjectURL(blob);
    
    link.setAttribute('href', url);
    link.setAttribute('download', `trade_log_${new Date().toISOString().split('T')[0]}.csv`);
    link.style.visibility = 'hidden';
    
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    
    showNotification("CSV exported successfully!", "success");
  } catch (error) {
    console.error("Export error:", error);
    showNotification("Error exporting CSV. Please try again.", "error");
  }
}

// ---------- View All Trades ----------
function openAllTrades() {
  if (filteredTrades.length === 0) {
    showNotification("No trades to display!", "warning");
    return;
  }

  const newWindow = window.open("", "_blank");
  const totalPL = filteredTrades.reduce((sum, t) => sum + parseFloat(t.pl), 0);
  const wins = filteredTrades.filter(t => t.pl > 0).length;
  const winRate = filteredTrades.length > 0 ? ((wins / filteredTrades.length) * 100).toFixed(2) : 0;

  let html = `
    <!DOCTYPE html>
    <html>
      <head>
        <title>All Trades - Options Trade Log</title>
        <meta name="viewport" content="width=device-width, initial-scale=1.0">
        <style>
          body { 
            font-family: 'Segoe UI', Tahoma, Geneva, Verdana, sans-serif; 
            margin: 20px; 
            background: #f8f9fa;
          }
          .header {
            background: white;
            padding: 20px;
            border-radius: 10px;
            margin-bottom: 20px;
            box-shadow: 0 2px 10px rgba(0,0,0,0.1);
          }
          .summary {
            display: grid;
            grid-template-columns: repeat(auto-fit, minmax(200px, 1fr));
            gap: 15px;
            margin-bottom: 20px;
          }
          .summary-item {
            background: white;
            padding: 15px;
            border-radius: 8px;
            text-align: center;
            box-shadow: 0 2px 5px rgba(0,0,0,0.1);
          }
          table { 
            width: 100%; 
            border-collapse: collapse; 
            background: white;
            border-radius: 10px;
            overflow: hidden;
            box-shadow: 0 2px 10px rgba(0,0,0,0.1);
          }
          th, td { 
            border: 1px solid #ddd; 
            padding: 12px 8px; 
            text-align: center; 
            font-size: 0.9rem;
          }
          th { 
            background: linear-gradient(135deg, #667eea, #764ba2); 
            color: white; 
            font-weight: 600;
          }
          tr:nth-child(even) { background: #f8f9fa; }
          tr:hover { background: #e9ecef; }
          .profit { color: #28a745; font-weight: bold; }
          .loss { color: #dc3545; font-weight: bold; }
          @media (max-width: 768px) {
            body { margin: 10px; }
            th, td { padding: 8px 4px; font-size: 0.8rem; }
          }
          @media print {
            body { margin: 0; }
            .no-print { display: none; }
          }
        </style>
      </head>
      <body>
        <div class="header">
          <h1>All Trades Report</h1>
          <p>Generated on ${new Date().toLocaleDateString()}</p>
        </div>
        
        <div class="summary">
          <div class="summary-item">
            <h3>${filteredTrades.length}</h3>
            <p>Total Trades</p>
          </div>
          <div class="summary-item">
            <h3 class="${totalPL >= 0 ? 'profit' : 'loss'}">${totalPL >= 0 ? '+' : ''}$${totalPL.toFixed(2)}</h3>
            <p>Total P/L</p>
          </div>
          <div class="summary-item">
            <h3>${winRate}%</h3>
            <p>Win Rate</p>
          </div>
          <div class="summary-item">
            <h3>${wins}</h3>
            <p>Winning Trades</p>
          </div>
        </div>
        
        <table>
          <thead>
            <tr>
              <th>Date</th>
              <th>Symbol</th>
              <th>Strike</th>
              <th>Type</th>
              <th>Qty</th>
              <th>Buy Price</th>
              <th>Sell Price</th>
              <th>P/L</th>
              <th>Return %</th>
            </tr>
          </thead>
          <tbody>
  `;

  filteredTrades.forEach(t => {
    const pl = parseFloat(t.pl);
    const returnPct = parseFloat(t.return_pct);
    html += `
      <tr>
        <td>${formatDate(t.trade_date)}</td>
        <td><strong>${t.symbol}</strong></td>
        <td>$${parseFloat(t.strike_price).toFixed(2)}</td>
        <td>${t.option_type}</td>
        <td>${t.quantity}</td>
        <td>$${parseFloat(t.buy_price).toFixed(2)}</td>
        <td>$${parseFloat(t.sell_price).toFixed(2)}</td>
        <td class="${pl >= 0 ? 'profit' : 'loss'}">${pl >= 0 ? '+' : ''}$${pl.toFixed(2)}</td>
        <td class="${returnPct >= 0 ? 'profit' : 'loss'}">${returnPct >= 0 ? '+' : ''}${returnPct.toFixed(2)}%</td>
      </tr>
    `;
  });

  html += `
          </tbody>
        </table>
        <div class="no-print" style="margin-top: 20px; text-align: center;">
          <button onclick="window.print()" style="padding: 10px 20px; background: #667eea; color: white; border: none; border-radius: 5px; cursor: pointer;">Print Report</button>
        </div>
      </body>
    </html>
  `;

  newWindow.document.write(html);
  newWindow.document.close();
  
  showNotification("All trades opened in new window", "info");
}

// Add CSS for badges
const additionalStyle = document.createElement('style');
additionalStyle.textContent = `
  .badge {
    padding: 4px 8px;
    border-radius: 12px;
    font-size: 0.75rem;
    font-weight: 600;
    text-transform: uppercase;
  }
  .badge.call {
    background: rgba(40, 167, 69, 0.1);
    color: #28a745;
    border: 1px solid rgba(40, 167, 69, 0.3);
  }
  .badge.put {
    background: rgba(220, 53, 69, 0.1);
    color: #dc3545;
    border: 1px solid rgba(220, 53, 69, 0.3);
  }
`;
document.head.appendChild(additionalStyle);
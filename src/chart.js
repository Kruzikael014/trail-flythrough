import Chart from 'chart.js/auto';
import { state } from './state.js';

export function buildChart() {
  if (state.elevChart) state.elevChart.destroy();
  const eles = state.pts.map(p => p.ele);
  state.elevChart = new Chart(document.getElementById('ec').getContext('2d'), {
    type: 'line',
    data: {
      labels: state.pts.map((_, i) => i),
      datasets: [
        {
          data: eles,
          fill: true,
          tension: 0.3,
          borderColor: '#7c6fff',
          backgroundColor: 'rgba(124,111,255,0.1)',
          borderWidth: 1.5,
          pointRadius: 0,
        },
        {
          data: Array(state.pts.length).fill(null),
          showLine: false,
          pointRadius: state.pts.map((_, i) => i === 0 ? 5 : 0),
          pointBackgroundColor: '#ff9f5a',
          borderWidth: 0,
        },
      ],
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      plugins: { legend: { display: false }, tooltip: { enabled: false } },
      scales: {
        x: { display: false },
        y: {
          ticks: { font: { size: 9 }, maxTicksLimit: 3, color: '#6b6b8a' },
          grid: { color: 'rgba(255,255,255,0.04)' },
          border: { display: false },
        },
      },
      animation: { duration: 0 },
    },
  });
}

export function updChart(idx) {
  if (!state.elevChart) return;
  const eles = state.pts.map(p => p.ele);
  const d = Array(state.pts.length).fill(null);
  d[idx] = eles[idx];
  state.elevChart.data.datasets[1].data = d;
  state.elevChart.data.datasets[1].pointRadius = state.pts.map((_, k) => k === idx ? 5 : 0);
  state.elevChart.update('none');
}

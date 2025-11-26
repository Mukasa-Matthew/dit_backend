const { ChartJSNodeCanvas } = require('chartjs-node-canvas');
const path = require('path');
const fs = require('fs').promises;

/**
 * Generate a pie chart image for vote distribution
 * @param {Array} candidates - Array of candidates with votes
 * @param {string} positionName - Name of the position
 * @returns {Promise<Buffer>} - Chart image buffer
 */
async function generatePieChart(candidates, positionName) {
  const width = 400;
  const height = 400;

  const chartJSNodeCanvas = new ChartJSNodeCanvas({ width, height });

  // Calculate total votes
  const totalVotes = candidates.reduce((sum, c) => sum + c._count.votes, 0);

  // Prepare chart data
  const labels = candidates.map(c => c.name.length > 20 ? c.name.substring(0, 20) + '...' : c.name);
  const data = candidates.map(c => c._count.votes);
  const percentages = candidates.map(c => 
    totalVotes > 0 ? ((c._count.votes / totalVotes) * 100).toFixed(1) : 0
  );

  // Color palette
  const colors = [
    'rgba(59, 130, 246, 0.8)',   // Blue
    'rgba(16, 185, 129, 0.8)',   // Green
    'rgba(245, 158, 11, 0.8)',   // Amber
    'rgba(239, 68, 68, 0.8)',    // Red
    'rgba(139, 92, 246, 0.8)',   // Purple
    'rgba(20, 184, 166, 0.8)',   // Teal
    'rgba(249, 115, 22, 0.8)',   // Orange
    'rgba(236, 72, 153, 0.8)',   // Pink
  ];

  const backgroundColors = candidates.map((_, index) => colors[index % colors.length]);
  const borderColors = candidates.map((_, index) => colors[index % colors.length].replace('0.8', '1'));

  const configuration = {
    type: 'pie',
    data: {
      labels: labels.map((label, i) => `${label} (${percentages[i]}%)`),
      datasets: [{
        data: data,
        backgroundColor: backgroundColors,
        borderColor: '#ffffff',
        borderWidth: 3,
      }],
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      plugins: {
        title: {
          display: true,
          text: `Vote Distribution - ${positionName}`,
          font: {
            size: 18,
            weight: 'bold',
            family: 'Arial',
          },
          color: '#111827',
          padding: {
            top: 10,
            bottom: 20,
          },
        },
        legend: {
          position: 'right',
          labels: {
            font: {
              size: 12,
              weight: '500',
              family: 'Arial',
            },
            padding: 18,
            usePointStyle: true,
            pointStyle: 'circle',
            color: '#374151',
          },
        },
        tooltip: {
          backgroundColor: 'rgba(0, 0, 0, 0.8)',
          padding: 12,
          titleFont: {
            size: 13,
            weight: 'bold',
          },
          bodyFont: {
            size: 12,
          },
          callbacks: {
            label: function(context) {
              const label = context.label || '';
              const value = context.parsed || 0;
              const total = context.dataset.data.reduce((a, b) => a + b, 0);
              const percentage = total > 0 ? ((value / total) * 100).toFixed(1) : 0;
              return `${label.split(' (')[0]}: ${value} vote${value !== 1 ? 's' : ''} (${percentage}%)`;
            },
          },
        },
      },
    },
  };

  const imageBuffer = await chartJSNodeCanvas.renderToBuffer(configuration);
  return imageBuffer;
}

/**
 * Load candidate photo or generate placeholder
 * @param {string} photoUrl - Photo URL path
 * @param {string} candidateName - Candidate name for placeholder
 * @returns {Promise<Buffer|null>} - Image buffer or null
 */
async function loadCandidatePhoto(photoUrl, candidateName) {
  if (!photoUrl) {
    return null;
  }

  try {
    const photoPath = path.join(__dirname, '../../', photoUrl);
    const imageBuffer = await fs.readFile(photoPath);
    return imageBuffer;
  } catch (error) {
    console.warn(`Failed to load photo for ${candidateName}:`, error.message);
    return null;
  }
}

module.exports = {
  generatePieChart,
  loadCandidatePhoto,
};


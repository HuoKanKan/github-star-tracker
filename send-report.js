const nodemailer = require('nodemailer');

const GRAPHQL_URL = 'https://api.github.com/graphql';
const REPO = process.env.REPO || 'rustfs/rustfs';
const EMAIL_FROM = process.env.EMAIL_FROM || 'fish_code@126.com';
const EMAIL_TO = process.env.EMAIL_TO || 'oracle_hkk@outlook.com';
const EMAIL_PASSWORD = process.env.EMAIL_PASSWORD || 'QKhANG7ecCKd5rcA';

async function graphqlFetch(query, variables = {}) {
  const token = process.env.TOKEN;
  const headers = { 'Content-Type': 'application/json' };
  if (token) headers['Authorization'] = `Bearer ${token}`;
  
  const response = await fetch(GRAPHQL_URL, {
    method: 'POST',
    headers,
    body: JSON.stringify({ query, variables })
  });
  
  if (!response.ok) {
    throw new Error(`API Error: ${response.status} ${response.statusText}`);
  }
  
  const data = await response.json();
  if (data.errors) {
    throw new Error(`GraphQL Error: ${data.errors.map(e => e.message).join(', ')}`);
  }
  return data.data;
}

async function fetchStars(sinceTime = null) {
  const [owner, name] = REPO.split('/');
  const thirtyDaysAgo = new Date();
  thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);
  const startTime = sinceTime || thirtyDaysAgo.toISOString();
  
  const allStars = [];
  let cursor = null;
  let hasNextPage = true;
  let pageCount = 0;
  
  while (hasNextPage && pageCount < 50) {
    pageCount++;
    const query = `
      query($owner: String!, $name: String!, $first: Int!, $after: String) {
        repository(owner: $owner, name: $name) {
          stargazerCount
          stargazers(first: $first, after: $after, orderBy: {field: STARRED_AT, direction: DESC}) {
            edges { starredAt }
            pageInfo { hasNextPage endCursor }
          }
        }
      }
    `;
    const data = await graphqlFetch(query, { owner, name, first: 100, after: cursor });
    const edges = data.repository.stargazers.edges;
    const pageInfo = data.repository.stargazers.pageInfo;
    
    let shouldStop = false;
    for (const edge of edges) {
      if (edge.starredAt >= startTime) {
        allStars.push({ starred_at: edge.starredAt });
      } else {
        shouldStop = true;
        break;
      }
    }
    
    hasNextPage = pageInfo.hasNextPage;
    cursor = pageInfo.endCursor;
    if (shouldStop) break;
  }
  
  allStars.sort((a, b) => new Date(a.starred_at) - new Date(b.starred_at));
  return allStars;
}

function computeMetrics(stars, totalStars) {
  const dateCounts = new Map();
  stars.forEach(star => {
    const date = new Date(star.starred_at);
    const dateStr = `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
    dateCounts.set(dateStr, (dateCounts.get(dateStr) || 0) + 1);
  });
  
  const baseStars = Math.max(0, totalStars - stars.length);
  const result = [];
  let cumulative = baseStars;
  
  const startDate = new Date();
  startDate.setDate(startDate.getDate() - 29);
  startDate.setHours(0, 0, 0, 0);
  const endDate = new Date();
  endDate.setHours(23, 59, 59, 999);
  
  for (let d = new Date(startDate); d <= endDate; d.setDate(d.getDate() + 1)) {
    const dateStr = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
    const dailyCount = dateCounts.get(dateStr) || 0;
    cumulative += dailyCount;
    result.push({ date: dateStr, delta: dailyCount, total: cumulative });
  }
  
  return result;
}

function computeWeekMetrics(dailyData) {
  const today = new Date();
  today.setHours(23, 59, 59, 999);
  const dayOfWeek = today.getDay();
  const daysSinceMonday = dayOfWeek === 0 ? 6 : dayOfWeek - 1;
  
  const thisWeekStart = new Date(today);
  thisWeekStart.setDate(today.getDate() - daysSinceMonday);
  thisWeekStart.setHours(0, 0, 0, 0);
  
  const lastWeekStart = new Date(thisWeekStart);
  lastWeekStart.setDate(lastWeekStart.getDate() - 7);
  const lastWeekEnd = new Date(thisWeekStart);
  lastWeekEnd.setDate(lastWeekEnd.getDate() - 1);
  lastWeekEnd.setHours(23, 59, 59, 999);
  
  const weekBeforeLastStart = new Date(lastWeekStart);
  weekBeforeLastStart.setDate(weekBeforeLastStart.getDate() - 7);
  const weekBeforeLastEnd = new Date(lastWeekStart);
  weekBeforeLastEnd.setDate(weekBeforeLastEnd.getDate() - 1);
  weekBeforeLastEnd.setHours(23, 59, 59, 999);
  
  let thisWeekGrowth = 0;
  let lastWeekGrowth = 0;
  let weekBeforeLastGrowth = 0;
  
  dailyData.forEach(item => {
    const itemDate = new Date(item.date + 'T23:59:59');
    if (itemDate >= thisWeekStart && itemDate <= today) thisWeekGrowth += item.delta;
    if (itemDate >= lastWeekStart && itemDate <= lastWeekEnd) lastWeekGrowth += item.delta;
    if (itemDate >= weekBeforeLastStart && itemDate <= weekBeforeLastEnd) weekBeforeLastGrowth += item.delta;
  });
  
  return { thisWeekGrowth, lastWeekGrowth, weekBeforeLastGrowth };
}

function generateEmailHTML(metrics, totalStars, dailyData) {
  const last = dailyData[dailyData.length - 1];
  const first = dailyData[0];
  const totalGrowth = last.total - first.total;
  const starsBefore30Days = first.total;
  const growthPercent = starsBefore30Days > 0 ? (totalGrowth / starsBefore30Days * 100).toFixed(2) : '0.00';
  const days = dailyData.length - 1;
  const avgDaily = days > 0 ? (totalGrowth / days).toFixed(1) : '0';
  
  const { thisWeekGrowth, lastWeekGrowth, weekBeforeLastGrowth } = metrics;
  const weekDiff = lastWeekGrowth - weekBeforeLastGrowth;
  const weekPercent = weekBeforeLastGrowth > 0 ? ((weekDiff / weekBeforeLastGrowth) * 100).toFixed(1) : '0.0';
  
  const today = new Date().toLocaleDateString('zh-CN');
  
  let tableRows = dailyData.slice().reverse().map(item => `
    <tr style="${item.delta > 0 ? 'background: #f0fdf4;' : ''}">
      <td style="padding: 8px 12px; border: 1px solid #e5e7eb; text-align: center;">${item.date}</td>
      <td style="padding: 8px 12px; border: 1px solid #e5e7eb; text-align: center; color: ${item.delta > 0 ? '#059669' : item.delta < 0 ? '#dc2626' : '#6b7280'}; font-weight: 600;">${item.delta > 0 ? '+' : ''}${item.delta}</td>
      <td style="padding: 8px 12px; border: 1px solid #e5e7eb; text-align: center;">${item.total.toLocaleString()}</td>
    </tr>
  `).join('');
  
  return `
<!DOCTYPE html>
<html>
<head>
  <meta charset="UTF-8">
</head>
<body style="margin: 0; padding: 0; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; background: #f0f2f5;">
  <table width="100%" cellpadding="0" cellspacing="0" style="background: #f0f2f5;">
    <tr>
      <td align="center" style="padding: 20px 10px;">
        <table width="600" cellpadding="0" cellspacing="0" style="background: #ffffff; border-radius: 8px; overflow: hidden; box-shadow: 0 2px 8px rgba(0,0,0,0.08);">
          <!-- Header -->
          <tr>
            <td style="background: #1e6fdf; padding: 20px 24px; text-align: center;">
              <h1 style="margin: 0; color: #ffffff; font-size: 20px; font-weight: 600;">${REPO} Star 周报</h1>
              <p style="margin: 6px 0 0; color: rgba(255,255,255,0.85); font-size: 13px;">生成时间：${today}</p>
            </td>
          </tr>
          <!-- Metrics -->
          <tr>
            <td style="padding: 20px;">
              <table width="100%" cellpadding="0" cellspacing="0">
                <tr>
                  <td width="48%" style="background: #f8fafc; border: 1px solid #e5e7eb; border-radius: 6px; padding: 16px; text-align: center; vertical-align: top;">
                    <div style="font-size: 12px; color: #6b7280; margin-bottom: 8px;">最新 Star 总数</div>
                    <div style="font-size: 26px; font-weight: 700; color: #1e6fdf;">${totalStars.toLocaleString()}</div>
                  </td>
                  <td width="4%"></td>
                  <td width="48%" style="background: #f8fafc; border: 1px solid #e5e7eb; border-radius: 6px; padding: 16px; text-align: center; vertical-align: top;">
                    <div style="font-size: 12px; color: #6b7280; margin-bottom: 8px;">近30天累计增长</div>
                    <div style="font-size: 26px; font-weight: 700; color: #1e6fdf;">+${totalGrowth}</div>
                    <div style="font-size: 12px; color: #10b981; margin-top: 4px;">▲ ${growthPercent}%</div>
                  </td>
                </tr>
                <tr><td colspan="3" height="12"></td></tr>
                <tr>
                  <td width="48%" style="background: #f8fafc; border: 1px solid #e5e7eb; border-radius: 6px; padding: 16px; text-align: center; vertical-align: top;">
                    <div style="font-size: 12px; color: #6b7280; margin-bottom: 8px;">平均每天日增</div>
                    <div style="font-size: 26px; font-weight: 700; color: #1e6fdf;">~${avgDaily}</div>
                    <div style="font-size: 12px; color: #10b981; margin-top: 4px;">stars/天</div>
                  </td>
                  <td width="4%"></td>
                  <td width="48%" style="background: #f0fdf4; border: 1px solid #86efac; border-radius: 6px; padding: 16px; text-align: center; vertical-align: top;">
                    <div style="font-size: 12px; color: #6b7280; margin-bottom: 8px;">上周 vs 上上周</div>
                    <div style="font-size: 26px; font-weight: 700; color: #059669;">${weekDiff > 0 ? '+' : ''}${weekDiff}</div>
                    <div style="font-size: 12px; color: #059669; margin-top: 4px;">上周 ${lastWeekGrowth} | 上上周 ${weekBeforeLastGrowth} ${weekDiff > 0 ? '▲' : '▼'} ${Math.abs(weekPercent)}%</div>
                    <div style="font-size: 11px; color: #6b7280; margin-top: 4px;">本周至今: ${thisWeekGrowth}</div>
                  </td>
                </tr>
              </table>
            </td>
          </tr>
          <!-- Table -->
          <tr>
            <td style="padding: 0 20px 20px;">
              <h2 style="font-size: 15px; color: #374151; margin: 0 0 12px;"> 近30天每日增长明细</h2>
              <table width="100%" cellpadding="0" cellspacing="0" style="border-collapse: collapse; font-size: 13px;">
                <thead>
                  <tr>
                    <th style="background: #f3f4f6; padding: 10px 12px; text-align: center; font-weight: 600; color: #4b5563; border: 1px solid #e5e7eb;">日期</th>
                    <th style="background: #f3f4f6; padding: 10px 12px; text-align: center; font-weight: 600; color: #4b5563; border: 1px solid #e5e7eb;">当日新增</th>
                    <th style="background: #f3f4f6; padding: 10px 12px; text-align: center; font-weight: 600; color: #4b5563; border: 1px solid #e5e7eb;">累计总数</th>
                  </tr>
                </thead>
                <tbody>${tableRows}</tbody>
              </table>
            </td>
          </tr>
          <!-- Footer -->
          <tr>
            <td style="text-align: center; padding: 16px; background: #f9fafb; color: #9ca3af; font-size: 12px;">
              由 GitHub Actions 自动生成 · GitHub Star 增长看板
            </td>
          </tr>
        </table>
      </td>
    </tr>
  </table>
</body>
</html>
  `;
}

async function main() {
  console.log(`开始生成 ${REPO} 的 Star 周报...`);
  
  const [owner, name] = REPO.split('/');
  const repoInfo = await graphqlFetch(`
    query($owner: String!, $name: String!) {
      repository(owner: $owner, name: $name) {
        stargazerCount
      }
    }
  `, { owner, name });
  
  const totalStars = repoInfo.repository.stargazerCount;
  console.log(`仓库总 Star 数: ${totalStars}`);
  
  const stars = await fetchStars();
  console.log(`获取了 ${stars.length} 个近30天的 Star`);
  
  const dailyData = computeMetrics(stars, totalStars);
  const weekMetrics = computeWeekMetrics(dailyData);
  
  const emailHTML = generateEmailHTML(weekMetrics, totalStars, dailyData);
  
  const transporter = nodemailer.createTransport({
    host: 'smtp.126.com',
    port: 465,
    secure: true,
    auth: {
      user: EMAIL_FROM,
      pass: EMAIL_PASSWORD
    }
  });
  
  await transporter.sendMail({
    from: EMAIL_FROM,
    to: EMAIL_TO,
    subject: `⭐ ${REPO} Star 周报 - ${new Date().toLocaleDateString('zh-CN')}`,
    html: emailHTML
  });
  
  console.log(`✅ 周报已发送至 ${EMAIL_TO}`);
}

main().catch(err => {
  console.error('❌ 错误:', err);
  process.exit(1);
});
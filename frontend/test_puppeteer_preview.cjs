const puppeteer = require('puppeteer');

(async () => {
  const browser = await puppeteer.launch();
  const page = await browser.newPage();
  
  page.on('console', msg => {
    console.log('PAGE LOG:', msg.text());
  });

  page.on('pageerror', err => {
    console.log('PAGE ERROR:', err.toString());
  });

  await page.goto('http://localhost:4173', { waitUntil: 'load', timeout: 30000 });
  
  await new Promise(r => setTimeout(r, 2000));
  await page.screenshot({ path: 'test_port_4173.png' });
  console.log('Screenshot taken at test_port_4173.png');
  await browser.close();
})();

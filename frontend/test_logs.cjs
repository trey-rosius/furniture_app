const puppeteer = require('puppeteer');

(async () => {
  const browser = await puppeteer.launch();
  const page = await browser.newPage();

  page.on('pageerror', err => {
    console.log('PAGE ERROR STR:', err.toString());
    console.log('PAGE ERROR STACK:', err.stack);
  });

  await page.goto('http://localhost:5176', { waitUntil: 'load' });
  await new Promise(r => setTimeout(r, 2000));
  await browser.close();
})();

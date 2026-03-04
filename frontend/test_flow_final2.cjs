const puppeteer = require('puppeteer');

(async () => {
  const browser = await puppeteer.launch();
  const page = await browser.newPage();
  
  page.on('console', msg => {
    if (msg.type() === 'error') console.log('PAGE ERROR LOG:', msg.text());
    else console.log('PAGE LOG:', msg.text());
  });
  page.on('pageerror', err => console.log('PAGE EXCEPTION:', err.toString()));
  page.on('dialog', async dialog => {
    console.log('ALERT ENCOUNTERED:', dialog.message());
    await dialog.accept();
  });

  try {
    await page.goto('http://localhost:5173', { waitUntil: 'domcontentloaded', timeout: 10000 });
    console.log('Navigated to /');
    await new Promise(r => setTimeout(r, 2000));
    await page.screenshot({ path: 'home-page-screenshot.png' });
    console.log('Took screenshot of home page.');

    await page.goto('http://localhost:5173/chat', { waitUntil: 'domcontentloaded', timeout: 10000 });
    console.log('Navigated to /chat');
    await new Promise(r => setTimeout(r, 2000));
    await page.screenshot({ path: 'chat-page-screenshot.png' });
    console.log('Took screenshot of chat page.');

    const inputs = await page.$$('input[type="text"]');
    if (inputs.length > 0) {
      await inputs[0].type('Hello');
      await page.keyboard.press('Enter');
      console.log('Typed message and pressed Enter');
      await new Promise(r => setTimeout(r, 6000));
      await page.screenshot({ path: 'chat-response-screenshot.png' });
      console.log('Took screenshot of chat response.');
      
      const buttons = await page.$$('button');
      if (buttons.length > 2) {
        await buttons[1].evaluate(b => b.click());
        await new Promise(r => setTimeout(r, 1000));
      }
    }

    await page.goto('http://localhost:5173/camera', { waitUntil: 'domcontentloaded', timeout: 10000 });
    console.log('Navigated to /camera');
    await new Promise(r => setTimeout(r, 2000));
    await page.screenshot({ path: 'camera-page-screenshot.png' });
    console.log('Took screenshot of camera page.');
  } catch (e) {
    console.log('Caught exception:', e.message);
  } finally {
    await browser.close();
  }
})();

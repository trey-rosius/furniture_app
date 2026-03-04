const puppeteer = require('puppeteer');

(async () => {
  const browser = await puppeteer.launch();
  const page = await browser.newPage();
  
  // Set up console log capturing
  page.on('console', msg => {
    if (msg.type() === 'error') {
      console.log('PAGE ERROR LOG:', msg.text());
    } else {
      console.log('PAGE LOG:', msg.text());
    }
  });

  page.on('pageerror', err => {
    console.log('PAGE EXCEPTION:', err.toString());
  });

  await page.goto('http://localhost:5173', { waitUntil: 'load', timeout: 30000 });
  
  // Wait for the main page to load
  try {
    await page.waitForSelector('h1', {timeout: 5000});
  } catch(e) {}
  
  await page.screenshot({ path: 'home-page-screenshot.png' });
  console.log('Took screenshot of home page: home-page-screenshot.png');

  await page.goto('http://localhost:5173/chat', { waitUntil: 'load' });
  console.log('Navigated to chat page');
  
  await new Promise(r => setTimeout(r, 2000));
  await page.screenshot({ path: 'chat-page-screenshot.png' });
  console.log('Took screenshot of chat page: chat-page-screenshot.png');
    
  // Type a message in input
  const inputs = await page.$$('input[type="text"]');
  if (inputs.length > 0) {
    await inputs[0].type('I need a mid-century modern chair');
    await page.keyboard.press('Enter');
    console.log('Typed message and pressed Enter');
      
    // Wait for response
    await new Promise(r => setTimeout(r, 4000));
      
    // Screenshot chat with response
    await page.screenshot({ path: 'chat-response-screenshot.png' });
    console.log('Took screenshot of chat response: chat-response-screenshot.png');
    
    // Test the voice alert by finding the mic button
    // It's usually the button that contains a mic icon. Let's find button with mic inside:
    // Actually the second button is usually mic, let's just click all buttons and intercept alert
    
    page.on('dialog', async dialog => {
      console.log('ALERT ENCOUNTERED:', dialog.message());
      await dialog.accept();
    });
    
    const buttons = await page.$$('button');
    if (buttons.length > 2) {
      // First is usually return, next is chat input attachments/mic etc. Let's just click index 1 and 2
      await buttons[1].evaluate(b => b.click());
      await new Promise(r => setTimeout(r, 500));
      await buttons[2].evaluate(b => b.click());
      await new Promise(r => setTimeout(r, 500));
    }
    
  } else {
    console.log('Could not find chat input.');
  }
  
  await page.goto('http://localhost:5173/camera', { waitUntil: 'load' });
  console.log('Navigated to camera page');
  await new Promise(r => setTimeout(r, 2000));
  await page.screenshot({ path: 'camera-page-screenshot.png' });
  console.log('Took screenshot of camera page: camera-page-screenshot.png');

  await browser.close();
})();

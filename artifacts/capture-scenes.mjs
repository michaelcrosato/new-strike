import {chromium} from '@playwright/test';
import {writeFile} from 'node:fs/promises';
const browser=await chromium.launch({channel:'chrome',headless:true});
try {
  const page=await browser.newPage({viewport:{width:1440,height:900}});
  await page.goto('http://127.0.0.1:4189/?test');
  await page.waitForFunction(()=>window.blockhawk?.getPerformance().ready);
  const gpu=await page.evaluate(()=>{const gl=document.getElementById('scene').getContext('webgl2');const ext=gl.getExtension('WEBGL_debug_renderer_info');return ext?gl.getParameter(ext.UNMASKED_RENDERER_WEBGL):'unknown';});
  await page.locator('#deploy-button').click();
  for(const [name,x,z] of [['rescue-compound',10,-37],['storm-battery',96,-68],['harbor',84,65]]) {
    await page.evaluate(([x,z])=>window.blockhawk.test.position(x,z),[x,z]);
    await page.waitForTimeout(350);await page.screenshot({path:`artifacts/${name}.png`});
  }
  await writeFile('artifacts/hardware.json',JSON.stringify({gpu,...await page.evaluate(()=>window.blockhawk.getPerformance())},null,2));
  console.log(gpu);
} finally {await browser.close();}

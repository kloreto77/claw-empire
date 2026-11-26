
import {chromium} from "playwright";
import assert from "node:assert/strict";
import {mkdir} from "node:fs/promises";
const browser=await chromium.launch({headless:true});
await mkdir("mesa-v3-visual",{recursive:true});
try{
 const page=await browser.newPage({viewport:{width:1366,height:768},locale:"pt-BR"});
 const errors=[];page.on("pageerror",e=>errors.push(e.message));
 await page.addInitScript(token=>sessionStorage.setItem("claw_api_auth_token",token),process.env.API_AUTH_TOKEN);
 await page.goto(process.env.QA_BASE_URL??"http://127.0.0.1:18791",{waitUntil:"domcontentloaded"});
 await page.locator(".mv3-person").first().waitFor({timeout:45000});
 assert.equal(await page.locator(".mv3-person").count(),8);
 await page.screenshot({path:"mesa-v3-visual/escritorio.png"});
 await page.locator(".mv3-person").first().click();
 await page.getByRole("button",{name:"Instruções",exact:true}).click();
 await page.getByPlaceholder("Ainda não definido. Configure a estratégia quando estiver pronto.").waitFor();
 await page.screenshot({path:"mesa-v3-visual/agente.png"});
 await page.getByRole("button",{name:"Ferramentas",exact:true}).click();
 await page.getByText("Conexões operacionais individuais").waitFor();
 await page.getByRole("button",{name:"Fechar configuração"}).click();
 await page.getByRole("button",{name:"Mercado",exact:true}).click();
 await page.getByRole("textbox",{name:"Pesquisar ativos"}).fill("PETR4");
 await page.getByRole("button",{name:"PETR4",exact:true}).waitFor();
 await page.getByRole("button",{name:"PETR4",exact:true}).click();
 await page.getByRole("img",{name:"Velas de PETR4"}).waitFor();
 await page.screenshot({path:"mesa-v3-visual/mercado.png"});
 await page.getByRole("button",{name:"Configurações",exact:true}).click();
 await page.getByRole("heading",{name:"Configurações da Mesa"}).waitFor();
 await page.getByRole("button",{name:"Habilitar motor"}).waitFor();
 assert.deepEqual(errors,[]);
 console.log("Mesa V3: escritório, oito personagens, painel individual, mercado e configurações renderizados.");
}finally{await browser.close();}

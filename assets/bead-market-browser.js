const bridge = window.marketBrowser;
const byId = id => document.getElementById(id);
let busy = false;
function show(value) {
  byId('title').textContent = value.title || '材料比价'; byId('platform').textContent = value.platformLabel || '平台';
  byId('address').textContent = value.address || '正在打开…'; byId('status').textContent = value.message || '只读取商品资料，不会自动下单。';
  byId('subtitle').textContent = value.mode === 'login' ? '直接在官方页面登录；网页登录不等于平台API授权' : '自行登录并选择商品规格，再采集到采购表';
  byId('return').textContent = value.mode === 'login' ? '返回应用' : '返回采购表';
  document.documentElement.dataset.theme = value.dark ? 'dark' : 'light';
  busy = Boolean(value.busy); byId('capture').disabled = busy; byId('capture').textContent = busy ? value.mode === 'login' ? '正在保存确认…' : '正在采集…' : value.mode === 'login' ? '我已完成登录' : '采集当前商品';
  byId('back').disabled = !value.canBack; byId('forward').disabled = !value.canForward;
}
async function action(name) { if (!bridge || busy && name === 'capture') return; try { if (name === 'capture') { busy = true; byId('capture').disabled = true; } const result = await bridge.action(name); if (result) show(result); } catch (error) { byId('status').textContent = String(error.message || '操作未完成，请回采购表重试。').replace(/^Error invoking remote method '[^']+': (?:Error: )?/, ''); busy = false; byId('capture').disabled = false; } }
for (const name of ['back', 'forward', 'reload', 'capture', 'return', 'close', 'minimize']) byId(name).addEventListener('click', () => { void action(name); });
bridge?.onState(show); void action('state');

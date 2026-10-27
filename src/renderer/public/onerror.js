// Externo por causa da CSP (script-src 'self'): mostra qualquer erro de carregamento na própria página.
function show(m){var d=document.createElement('pre');d.style.cssText='color:#f55;white-space:pre-wrap;padding:12px;font:14px monospace';d.textContent='ERRO: '+m;document.body.appendChild(d)}
window.onerror=function(m,s,l,c){show(m+' @'+l+':'+c)}
window.addEventListener('unhandledrejection',function(e){show(String(e.reason&&e.reason.stack||e.reason))})

import {memoryBox} from './main.js?v=mobile-memory-1';

const $=id=>document.getElementById(id);
const views=document.createElement('div');views.className='arena-views';
views.setAttribute('aria-label','舞台视角');
for(const [label,angle] of [['正面',0],['右侧',Math.PI/2],['后台',Math.PI],['左侧',-Math.PI/2]]){
  const b=document.createElement('button');b.textContent=label;
  b.onclick=()=>{memoryBox.setAutoOrbit(false);memoryBox.setView(angle);};
  views.append(b);
}
document.querySelector('.scene-heading').append(views);
try{const ticket=JSON.parse(localStorage.getItem('palinode-ticket')||'{}');$('ticket-city').value=ticket.city||'';$('ticket-date').value=ticket.date||'';}catch{}
function updateTicket(){
  const city=$('ticket-city').value.trim(),date=$('ticket-date').value;
  memoryBox.setTicket(city||'某座城市',date||'某一天');
  try{localStorage.setItem('palinode-ticket',JSON.stringify({city,date}));}catch{}
}
$('ticket-city').addEventListener('input',updateTicket);$('ticket-date').addEventListener('input',updateTicket);updateTicket();
const updateState=()=>{
  const phase=$('stage').dataset.creation;
  $('scene-state').textContent=['card','projecting','generating','revealing'].includes(phase)?'构筑中 / PROCESSING':$('current-memory').hidden?'待存入 / STANDBY':'已载入 / MEMORY';
};
new MutationObserver(updateState).observe($('stage'),{attributes:true,attributeFilter:['data-creation']});
new MutationObserver(updateState).observe($('current-memory'),{attributes:true,attributeFilter:['hidden']});

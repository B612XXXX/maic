/* Standalone visual preview. In production, feed roster and speaker IDs from the classroom. */
const $=id=>document.getElementById(id);
const silhouette='<svg viewBox="0 0 100 130" aria-hidden="true"><ellipse cx="50" cy="28" rx="21" ry="25"/><path d="M36 49h28l4 11c19 4 28 20 29 40l2 27H1l2-27c1-20 10-36 29-40z"/></svg>';
const layouts={judge:{x:50,y:12,w:30},clerk:{x:83,y:22,w:10},left:{x:18.5,y:43,w:22},right:{x:81.5,y:43,w:22},witness:{x:50,y:65,w:12}};
const R=(id,label,zone,kind='silhouette',name='')=>({id,label,zone:zone==='leftCounsel'?'left':zone==='rightCounsel'?'right':zone,kind,name});
const cases={civil:{name:'合同争议 · 民事演练',labels:['原告席','被告席','诉讼代理人','诉讼代理人'],roles:[R('judge','审判长','judge'),R('judge2','审判员','judge'),R('judge3','人民陪审员','judge'),R('clerk','书记员','clerk'),R('plaintiff','原告','left'),R('defendant','被告','right'),R('user','原告代理人','leftCounsel','user','你'),R('peer','被告代理人','rightCounsel','peer','模拟学生'),R('witness','证人','witness')]},criminal:{name:'刑事案件 · 角色展示示例',labels:['公诉席','被告人席','公诉人','辩护人'],roles:[R('judge','审判长','judge'),R('judge2','审判员','judge'),R('judge3','人民陪审员','judge'),R('clerk','书记员','clerk'),R('prosecution','公诉方','left'),R('defendant','被告人','right'),R('peer','公诉人','leftCounsel','peer','模拟学生'),R('user','辩护人','rightCounsel','user','你'),R('witness','证人','witness')]},simple:{name:'单争点演练 · 精简角色',labels:['原告席','被告席','诉讼代理人','诉讼代理人'],roles:[R('judge','审判员','judge'),R('clerk','书记员','clerk'),R('user','原告代理人','leftCounsel','user','你'),R('peer','被告代理人','rightCounsel','peer','模拟学生')]}};
let scene=cases.civil,active=null,userAvatar='assets/user.png',peerEnabled=true,blob=null,zoom=100,lastEvidence=null;
let userNickname;
const evidence=[{id:'contract',title:'服务合同（节选）',kind:'文书 · 教学示例',src:'assets/contract.svg'},{id:'receipt',title:'付款记录',kind:'图片 · 教学示例',src:'assets/receipt.svg'}];
function safeImage(src){return typeof src==='string'&&(/^(https?:|blob:|data:image\/)/i.test(src)||/^(\/?assets\/|\/avatars\/)/.test(src))?src:'assets/user.png'}
function render(){
 $('caseName').textContent=scene.name;$('roles').replaceChildren();$('labels').replaceChildren();
 const labels=[['审判席',50,8,'judge'],[scene.labels[0],18.5,63,''],[scene.labels[1],81.5,63,'']];
 labels.forEach(([text,x,y,c])=>{const el=document.createElement('span');el.className='seat-label '+c;el.textContent=text;el.style.left=x+'%';el.style.top=y+'%';$('labels').append(el)});
 Object.entries(layouts).forEach(([zone,l])=>{const roles=scene.roles.filter(r=>r.zone===zone);if(zone==='judge'&&roles.length===3)[roles[0],roles[1]]=[roles[1],roles[0]];roles.forEach((r,i)=>{const x=l.x+(i-(roles.length-1)/2)*Math.min(11,l.w/roles.length);const el=document.createElement('div');el.className='role';el.dataset.roleId=r.id;el.style.left=x+'%';el.style.top=l.y+'%';const figure=document.createElement('div');figure.className='figure';const displayName=r.kind==='user'?(userNickname ?? r.name):r.name;const useAvatar=r.kind==='user'||r.kind==='peer'&&peerEnabled;if(useAvatar){const img=document.createElement('img');img.src=safeImage(r.kind==='user'?userAvatar:r.avatar||'assets/student.png');img.alt=displayName||r.label;img.onerror=()=>{figure.innerHTML=silhouette};figure.append(img)}else figure.innerHTML=silhouette;const plate=document.createElement('span');plate.className='nameplate';plate.textContent=r.label;if(useAvatar){const name=document.createElement('small');name.className='person-name';name.textContent=displayName||'';plate.append(name)}el.append(figure,plate);$('roles').append(el)})});setActiveRole(active);
}
function setActiveRole(id){active=scene.roles.some(r=>r.id===id)?id:null;document.querySelectorAll('.role').forEach(el=>{el.classList.toggle('active',el.dataset.roleId===active)});const r=scene.roles.find(r=>r.id===active);$('speaker').textContent=r?'当前发言 · '+r.label:'等待角色发言';}
function setScene(next){scene=next;active=null;render()}
$('caseSelect').onchange=e=>setScene(cases[e.target.value]);$('next').onclick=()=>setActiveRole(scene.roles[(scene.roles.findIndex(r=>r.id===active)+1)%scene.roles.length].id);$('clear').onclick=()=>setActiveRole(null);$('peer').onchange=e=>{peerEnabled=e.target.checked;render()};
$('avatarFile').onchange=e=>{const f=e.target.files[0];if(!f||!f.type.startsWith('image/'))return;if(blob)URL.revokeObjectURL(blob);blob=URL.createObjectURL(f);userAvatar=blob;render()};$('resetAvatar').onclick=()=>{if(blob)URL.revokeObjectURL(blob);blob=null;userAvatar='assets/user.png';$('avatarFile').value='';render()};
evidence.forEach(e=>{const b=document.createElement('button');b.className='evidence-card';b.setAttribute('aria-label','查看'+e.title);const img=document.createElement('img');img.src=e.src;img.alt=e.title+'缩略图';const title=document.createElement('strong');title.textContent=e.title;const kind=document.createElement('small');kind.textContent=e.kind;b.append(img,title,kind);b.onclick=()=>openEvidence(e,b);$('evidenceList').append(b)});
function updateZoom(){$('zoomValue').textContent=zoom+'%';$('viewerContent').style.width=zoom+'%'}
function openEvidence(e,trigger){lastEvidence=trigger;$('viewerTitle').textContent=e.title;$('viewerKind').textContent=e.kind;const img=document.createElement('img');img.src=e.src;img.alt=e.title+'完整内容';$('viewerContent').replaceChildren(img);zoom=100;updateZoom();$('viewer').showModal();$('viewerBody').scrollTop=0}
$('closeViewer').onclick=()=>$('viewer').close();$('viewer').addEventListener('close',()=>lastEvidence?.focus());$('viewer').onclick=e=>{if(e.target===$('viewer')){const r=$('viewer').getBoundingClientRect();if(e.clientX<r.left||e.clientX>r.right||e.clientY<r.top||e.clientY>r.bottom)$('viewer').close()}};$('zoomIn').onclick=()=>{zoom=Math.min(200,zoom+25);updateZoom()};$('zoomOut').onclick=()=>{zoom=Math.max(50,zoom-25);updateZoom()};$('zoomReset').onclick=()=>{zoom=100;updateZoom()};
window.courtroomScene = {
  setScene,
  setActiveRole,
  setUserProfile(profile) {
    userAvatar = safeImage(profile.avatar);
    userNickname = profile.nickname || '你';
    render();
  },
};
render();setActiveRole('user');

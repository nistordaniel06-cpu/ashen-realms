import Phaser from 'phaser';
const TILE_W=80,TILE_H=40,N=24;
const iso=(x:number,y:number)=>({x:(x-y)*TILE_W/2,y:(x+y)*TILE_H/2});
class Game extends Phaser.Scene {
 player={x:12,y:12,hp:100,xp:0,gold:0,kills:0}; hero!:Phaser.GameObjects.Arc; npc={x:10,y:10}; wolves=[{x:15,y:12,hp:3},{x:17,y:15,hp:3},{x:12,y:17,hp:3}]; keys!:Record<string,Phaser.Input.Keyboard.Key>; target?:{x:number,y:number}; hud!:Phaser.GameObjects.Text; info!:Phaser.GameObjects.Text; joystick={x:0,y:0}; attackAt=0; quest=false;
 constructor(){super('game')}
 create(){
  this.cameras.main.setBackgroundColor('#172a2b');
  const ground=this.add.graphics();
  for(let y=0;y<N;y++)for(let x=0;x<N;x++){const p=iso(x,y);ground.fillStyle((x+y)%3===0?0x416b4d:0x365d47);ground.fillPoints([{x:p.x,y:p.y-20},{x:p.x+40,y:p.y},{x:p.x,y:p.y+20},{x:p.x-40,y:p.y}],true);ground.lineStyle(1,0x243d34,.4);ground.strokePoints([{x:p.x,y:p.y-20},{x:p.x+40,y:p.y},{x:p.x,y:p.y+20},{x:p.x-40,y:p.y}],true)}
  const village=iso(10,10);this.add.rectangle(village.x,village.y-18,54,45,0xb99160).setStrokeStyle(3,0x493e34);this.add.text(village.x-38,village.y-65,'PĂZITORUL',{fontSize:'12px',color:'#f5e6ac'});
  this.hero=this.add.circle(0,0,13,0x61b8ef).setStrokeStyle(3,0xf3f5ef);this.hero.setDepth(100);
  this.keys=this.input.keyboard!.addKeys('W,A,S,D,UP,DOWN,LEFT,RIGHT,SPACE,E,I') as Record<string,Phaser.Input.Keyboard.Key>;
  this.input.on('pointerdown',(p:Phaser.Input.Pointer)=>{if(p.y>this.scale.height-130)return;const w=this.cameras.main.getWorldPoint(p.x,p.y);this.target={x:Phaser.Math.Clamp(w.y/TILE_H+w.x/TILE_W,0,N-1),y:Phaser.Math.Clamp(w.y/TILE_H-w.x/TILE_W,0,N-1)}});
  this.hud=this.add.text(14,12,'',{fontFamily:'Arial',fontSize:'16px',color:'#fff',backgroundColor:'#132d30dd',padding:{x:12,y:10}}).setScrollFactor(0).setDepth(1000);
  this.info=this.add.text(14,100,'',{fontFamily:'Arial',fontSize:'14px',color:'#f8e4b1',backgroundColor:'#132d30dd',padding:{x:10,y:8}}).setScrollFactor(0).setDepth(1000);
  this.add.text(12,this.scale.height-36,'WASD / click / joystick • ATAC • NPC',{fontSize:'13px',color:'#fff',backgroundColor:'#172a2bdd'}).setScrollFactor(0).setDepth(1000);
  const joy=this.add.circle(90,this.scale.height-105,53,0xffffff,.13).setScrollFactor(0).setDepth(1000).setInteractive();const knob=this.add.circle(90,this.scale.height-105,22,0x8ecbd0,.7).setScrollFactor(0).setDepth(1001);
  joy.on('pointerdown',(p:Phaser.Input.Pointer)=>{this.input.setDraggable(joy);joy.setData('active',true);moveJoy(p)});const moveJoy=(p:Phaser.Input.Pointer)=>{const dx=p.x-90,dy=p.y-(this.scale.height-105),l=Math.max(1,Math.hypot(dx,dy));this.joystick={x:dx/Math.max(53,l),y:dy/Math.max(53,l)};knob.setPosition(90+this.joystick.x*35,this.scale.height-105+this.joystick.y*35)};
  this.input.on('pointermove',(p:Phaser.Input.Pointer)=>{if(p.isDown&&p.x<170&&p.y>this.scale.height-180)moveJoy(p)});
  this.input.on('pointerup',()=>{this.joystick={x:0,y:0};knob.setPosition(90,this.scale.height-105)});
  const button=(x:number,label:string,cb:()=>void)=>this.add.text(x,this.scale.height-112,label,{fontFamily:'Arial',fontSize:'17px',color:'#fff',backgroundColor:'#8d5538',padding:{x:14,y:16}}).setScrollFactor(0).setDepth(1000).setInteractive().on('pointerdown',cb);
  button(this.scale.width-115,'ATAC',()=>this.attack());button(this.scale.width-115,'NPC',()=>this.talk()).setY(this.scale.height-57);
  this.cameras.main.startFollow(this.hero,true,.12,.12);this.cameras.main.setZoom(Math.min(1.25,Math.max(.7,this.scale.width/900)));
 }
 attack(){if(this.time.now-this.attackAt<400)return;this.attackAt=this.time.now;for(const w of this.wolves){if(w.hp>0&&Math.hypot(w.x-this.player.x,w.y-this.player.y)<2.2){w.hp--;if(w.hp===0){this.player.kills++;this.player.xp+=25;this.player.gold+=10}break}}}
 talk(){if(Math.hypot(this.player.x-this.npc.x,this.player.y-this.npc.y)>2.5){this.info.setText('Apropie-te de Păzitor!');return}if(this.player.kills>=3&&!this.quest){this.quest=true;this.player.gold+=100;this.player.xp+=50}this.info.setText(this.quest?'Misiune terminată! +100 gold, +50 XP':'Misiune: învinge 3 lupi, apoi revino.')}
 update(_t:number,dt:number){const p=this.player;let dx=0,dy=0;const k=this.keys;if(k.A.isDown||k.LEFT.isDown)dx--;if(k.D.isDown||k.RIGHT.isDown)dx++;if(k.W.isDown||k.UP.isDown)dy--;if(k.S.isDown||k.DOWN.isDown)dy++;dx+=this.joystick.x;dy+=this.joystick.y;if(!dx&&!dy&&this.target){dx=this.target.x-p.x;dy=this.target.y-p.y;if(Math.hypot(dx,dy)<.15)this.target=undefined}if(dx||dy){const m=Math.hypot(dx,dy),speed=dt*.003;p.x=Phaser.Math.Clamp(p.x+dx/m*speed,0,N-1);p.y=Phaser.Math.Clamp(p.y+dy/m*speed,0,N-1)}if(Phaser.Input.Keyboard.JustDown(k.SPACE))this.attack();if(Phaser.Input.Keyboard.JustDown(k.E))this.talk();const pos=iso(p.x,p.y);this.hero.setPosition(pos.x,pos.y-13);this.hero.setDepth(pos.y+100);this.wolves.forEach((w,i)=>{const id='wolf'+i;let shape=this.children.getByName(id) as Phaser.GameObjects.Arc;if(!shape){shape=this.add.circle(0,0,11,0xb64b42).setStrokeStyle(2,0x542e2a).setName(id)}shape.setVisible(w.hp>0);const v=iso(w.x,w.y);shape.setPosition(v.x,v.y-12).setDepth(v.y+90)});this.hud.setText('ASHEN REALMS V1  |  HP '+p.hp+'  XP '+p.xp+'  GOLD '+p.gold);if(!this.quest)this.info.setText('Quest: lupi '+p.kills+'/3  •  Apropie-te de NPC și apasă E');}
}
new Phaser.Game({type:Phaser.AUTO,parent:'app',width:960,height:600,backgroundColor:'#172a2b',scale:{mode:Phaser.Scale.RESIZE,autoCenter:Phaser.Scale.CENTER_BOTH},scene:[Game],render:{antialias:true}});

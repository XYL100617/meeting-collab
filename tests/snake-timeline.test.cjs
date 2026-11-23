const test=require('node:test');
const assert=require('node:assert/strict');
const snake=require('../public/project-snake-timeline.js');
const meetings=[
 {id:'m-3',title:'最新三星会议',date:'2026-11-14',time:'10:00',stars:3,host:'张伟',files:2,minutes:true,checked:3,attendees:4,assignments:2,logs:1},
 {id:'m-2',title:'较早二星会议',date:'2026-10-28',time:'16:00',stars:2,host:'李娜',files:0,minutes:false,checked:0,attendees:3,assignments:1,logs:0}
];
test('蛇形时间线默认只勾选三星并输出会议节点',()=>{
 const html=snake.render(meetings,{selectedStars:[3],starCounts:{3:1,2:1,1:0},scope:'mine'});
 assert.match(html,/data-snake-star="3" checked/);
 assert.doesNotMatch(html,/data-snake-star="2" checked/);
 assert.match(html,/data-open-meeting="m-3"/);
 assert.match(html,/data-open-meeting="m-2"/);
 assert.match(html,/最新三星会议/);
 assert.match(html,/2026-11-14 10:00/);
 assert.match(html,/snake-tier-3/);
 assert.match(html,/snake-tier-2/);
 assert.match(html,/data-snake-detail="files"/);
 assert.match(html,/snake-detail-view/);
});
test('蛇形时间线内容转义并正确计算路径高度',()=>{
 const html=snake.render([{...meetings[0],title:'<script>bad()</script>'}],{selectedStars:[3],starCounts:{3:1},scope:'team'});
 assert.doesNotMatch(html,/<script>bad\(\)<\/script>/);
 assert.match(html,/&lt;script&gt;bad\(\)&lt;\/script&gt;/);
 const four=snake.pathLayout(4),five=snake.pathLayout(5),six=snake.pathLayout(6);
 assert.ok(four.height>=470);
 assert.ok(six.height>=four.height);
 assert.equal(four.points.length,4);
 assert.equal(six.points.length,6);
 assert.match(five.path,/^M210 /);
 assert.match(five.path,/ H\d+ V\d+ H/);
 assert.doesNotMatch(five.path,/ C/);
 assert.equal(five.points[0].y,five.points[1].y);
 assert.equal(five.points[1].y,five.points[2].y);
 assert.notEqual(five.points[2].y,five.points[3].y);
 assert.equal(five.points[3].y,five.points[4].y);
});

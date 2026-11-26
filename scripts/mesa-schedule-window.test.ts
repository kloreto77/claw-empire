
import {test} from "node:test";
import assert from "node:assert/strict";
import {withinScheduleWindow,validScheduleWindow} from "../server/modules/desk-scheduler.ts";
test("window uses weekdays and explicit timezone",()=>{
 const w={days:[1,2,3,4,5],start:"09:00",end:"18:00",timezone:"America/Sao_Paulo"};
 assert.ok(validScheduleWindow(w));assert.ok(withinScheduleWindow(Date.parse("2026-11-23T12:00:00Z"),w));
 assert.equal(withinScheduleWindow(Date.parse("2026-11-23T11:59:00Z"),w),false);
 assert.equal(withinScheduleWindow(Date.parse("2026-11-22T15:00:00Z"),w),false);
 assert.equal(withinScheduleWindow(Date.parse("2026-11-23T21:00:00Z"),w),false);
 assert.equal(validScheduleWindow({...w,timezone:"INVALID"}),false);
 assert.equal(validScheduleWindow({...w,start:"19:00"}),false);
});

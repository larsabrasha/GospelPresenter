// The generated view types read and written as the core gives them: a live step's state and effects, an effect of a
// newer core's read as the base type, an event written with its tag, and a start page list. Exits 1 on a difference.
using System;
using System.Text.Json;
using GospelPresenter.Core;

var failures = 0;
void Check(string what, bool ok) { Console.WriteLine($"{(ok ? "ok" : "FAIL")}: {what}"); if (!ok) failures++; }

const string step = """
{"state":{"sessionId":"s1","deviceName":"Mac","started":true,"connected":true,"attempt":0,"heard":1763800123456,"pinged":false,
"lastSent":"","remote":false,"chosen":["d1"],"takeOver":[],"seen":[],"pointer":null,"audio":null,"video":null,"videoLive":null,
"sessions":[{"id":"s9"}],"online":[],"screens":[],"controllable":[],"control":{"sessionId":"s9","pending":null,"warned":false}},
"effects":[{"type":"openSocket"},{"type":"timer","name":"ping","ms":20000},{"type":"send","message":{"type":"ping"}},{"type":"teleport"}]}
""";
var s = JsonSerializer.Deserialize<LiveStep>(step)!;
Check("the state's fields", s.State.SessionId == "s1" && s.State.Heard == 1763800123456 && s.State.Chosen[0] == "d1" && s.State.Control?.SessionId == "s9");
Check("an effect without fields", s.Effects[0] is LiveEffect.OpenSocket);
Check("an effect with fields", s.Effects[1] is LiveEffect.Timer { Name: "ping", Ms: 20000 });
Check("an effect's any JSON", s.Effects[2] is LiveEffect.Send send && send.Message.GetProperty("type").GetString() == "ping");
Check("a newer core's effect read as Unknown", s.Effects[3] is LiveEffect.Unknown { Type: "teleport" });

LiveEvent ev = new LiveEvent.Output("d1", true, null);
var written = JsonSerializer.Serialize(ev);
Check($"an event written with its tag first ({written})", written.StartsWith("{\"type\":\"output\"") && written.Contains("\"id\":\"d1\""));
LiveEvent message = new LiveEvent.Message(JsonDocument.Parse("{\"type\":\"pong\"}").RootElement);
Check("a field named as its case", JsonSerializer.Serialize(message).Contains("\"message\":{\"type\":\"pong\"}"));

const string lists = """[{"id":"today","title":"presentations.today","showDate":false,"withYear":false,"rows":[{"id":"p","name":"Söndag","eventDate":"2026-11-22","deletedAt":null,"themeId":null,"isTemplate":false,"weekday":null,"time":"11:00","location":null,"description":null,"updatedAt":1,"lastUsedAt":null,"itemCount":3,"line":[{"key":"presentations.today","of":"date"},{"text":"11:00","of":"time"}]}]}]""";
var start = JsonSerializer.Deserialize<StartList[]>(lists)!;
Check("a start page row and its line", start[0].Rows[0].ItemCount == 3 && start[0].Rows[0].Line?[0].Key == "presentations.today" && start[0].Rows[0].Line?[1].Text == "11:00");

return failures == 0 ? 0 : 1;

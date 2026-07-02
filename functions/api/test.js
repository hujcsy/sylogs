export async function onRequest(context) {
  try {
    await context.env.DB.prepare("INSERT INTO logs (message) VALUES (?)")
            .bind("有人访问了网站！")
            .run();
    return new Response("數據庫寫入成功！", { status: 200 });
  } catch (err) {
    return new Response("錯誤: " + err.message, { status: 500 });
  }
}

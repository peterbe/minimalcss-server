const supertest = require("supertest");
const { app, _shutdown } = require("./server");

describe("start app", function() {
  let request = null;
  let server = null;

  beforeEach(done => {
    server = app.listen(done);
    request = supertest.agent(server);
  });

  afterEach(done => {
    server.close(done);
    _shutdown();
  });

  it("simplest get", function() {
    return request
      .get("/")
      .expect(200, /it works/)
      .expect("Content-Type", /text\/plain/);
  });
});

/**
 * Created by santi8ago8 on 13/09/14.
 */

var io = require('socket.io');
var pty = require('pty.js');
var ds = require('data-structures');
var uuid = require('uuid-lib');
var cookie = require('cookie');
var consolas = [];
var engine = require('./engine');
var ObjectID = require('mongodb').ObjectID
var fs = require('fs');
var gm = require('gm').subClass({ imageMagick: true });
var d = engine.errorHandler;

exports.init = function (server) {
    io = io(server);
};
exports.initMongo = function (db) {
    startUp();
    initSockets();
};

function startUp() {

    engine.commands.find().toArray(function (err, resp) {
        if (err)
            console.log(err);
        else {
            resp.forEach(function (com) {
                var term = new terminal();
                consolas.push(term);
                term.write(com.command + '\n');
            })
        }
    });

}

var terminal = function () {

    var self = this;
    self.rows = 20;
    self.cols = 80;
    self.queue = new ds.Queue();

    self.queue.enqueue(self.lastBuffer);

    self.term = pty.fork('bash', [], {
        name: ' ',
        cols: self.cols,
        rows: self.rows,
        cwd: process.env.HOME,
        env: process.env
    });
    this.pid = self.term.pid;
    this.write = function (data) {
        self.term.write(data);
    };
    this.close = function () {
        //end,kill,destroy, diference?????
        self.term.end();
        //self.term.kill();
        //self.term.destroy();
    };
    self.term.on('data', function (data) {

        if (data != null) {


            self.queue.enqueue(data);

            if (self.queue.size > 200) {
                self.queue.dequeue();
            }

            var d = {data: data, pid: self.pid};
            if (self.process != self.term.process) {
                d.process = self.term.process;
                self.process = d.process
            }
            io.to('global').emit('term:data', d);
        }
    });
    self.term.on('close', function (data) {
        io.to('global').emit('term:close', {pid: self.pid, exit: data});
        for (var i = 0; i < consolas.length; i++) {
            var c = consolas[i];
            if (c.pid == self.pid) {
                consolas.splice(i, 1);
                i--;
            }
        }
    });


};

var initSockets = function () {

    io.use(function (socket, next) {

        var cookie_string = socket.conn.request.headers.cookie;

        var parsed_cookies = cookie.parse(cookie_string);
        var connect_sid = parsed_cookies['connect.sid'];
        socket.roomSession = connect_sid;
        socket.join(connect_sid);

        socket.emit('login', {result: false});


        next();
    });

    io.on('connection', function (socket) {


        var doRest = function () {
            socket.loginCorrect = true;

            socket.roomLogged = socket.user;
            socket.roomGlobal = 'global';
            socket.join(socket.roomLogged);
            socket.join(socket.roomGlobal);

            consolas.forEach(function (c) {
                socket.emit('term:open', {pid: c.pid});
                var data = c.queue._content.join('');
                socket.emit('term:data', {data: data, pid: c.pid, process: c.term.process});
            })
        };

        socket.on('logout', function (data) {

            //destroy token.
            d.run(function () {
                engine.users.update(
                    {tokens: {$elemMatch: {
                        token: data.token,
                        ip: socket.handshake.address
                    }}},
                    {$pull: {tokens: {
                        token: data.token,
                        ip: socket.handshake.address
                    }}},
                    function (err, resp) {
                        if (err)
                            console.log(err);
                        else {
                            if (resp > 0) {
                                var sockets = get_sockets_by_room(socket.roomSession);

                                var roomLogged = socket.roomLogged;
                                var roomGlobal = socket.roomGlobal;

                                sockets.forEach(function (s) {
                                    s.leave(roomLogged);
                                    s.leave(roomGlobal);
                                    delete s.roomLogged;
                                    delete s.roomGlobal;
                                    delete s.loginCorrect;
                                });
                                io.to(socket.roomSession).emit('logout');
                            }
                        }
                    });

            });

        });

        //login token.
        socket.on('login:token', function (data) {
            d.run(function () {
                var ip = socket.handshake.address;
                engine.users.findOne({tokens: {$in: [
                    {token: data.token, ip: ip}
                ]}}, {name: 1, password: 1, profileImg: 1}, function (err, user) {
                    if (err)
                        console.log(err);
                    else {

                        if (!user)
                            io.to(socket.roomSession).emit('login:token', {result: false});
                        else {
                            var sockets = get_sockets_by_room(socket.roomSession);
                            sockets.forEach(function (s) {
                                s.loginCorrect = true;
                                s.user = user.name;
                            });
                            socket.emit('login:token', {result: true, name: user.name, profileImg: user.profileImg});
                        }
                    }
                })
            });
        });

        //login username and password
        socket.on('login:user', function (data) {
            d.run(function () {
                engine.users.findOne(
                    {name: data.name, password: data.password},
                    {name: 1, password: 1, profileImg: 1},
                    function (err, user) {
                        if (err)
                            console.log(err);
                        else {
                            if (!user)
                                io.to(socket.roomSession).emit('login:user', {result: false});
                            else {
                                var ip = socket.handshake.address;
                                var token = uuid.create().value + uuid.create().value + uuid.create().value + uuid.create().value + uuid.create().value + uuid.create().value;
                                //save token
                                engine.users.update(
                                    {_id: user._id},
                                    {$addToSet: {tokens: {token: token, ip: ip}}},
                                    {upsert: false, multi: false},
                                    function (err, updated) {
                                        if (err)
                                            console.log('saving token err', err);
                                        else {
                                            var sockets = get_sockets_by_room(socket.roomSession);
                                            sockets.forEach(function (s) {
                                                s.loginCorrect = true;
                                                s.user = user.name;
                                            });
                                            io.to(socket.roomSession).emit('login:user', {result: true, token: token, name: user.name, profileImg: user.profileImg});
                                        }

                                    }
                                )

                            }
                        }
                    })
            });
        });

        socket.on('readyToReceive', function () {
            if (socket.loginCorrect) {
                doRest(socket);
            }
            else {
                socket.emit('hack', 'don\'t hack!');
            }

        });


        /**
         *  Format data{
         *  id : one name of one binding
         *  value: value to bind
         *  }
         */
        socket.on('binding', function (data) {
            d.run(function () {
                var bind = getBinding(data.id);

                if (bind) {
                    var room;
                    if (bind.mode == 'session') {
                        room = socket.roomSession;
                    }
                    if (bind.mode == 'account' && socket.roomLogged) {
                        room = socket.roomLogged;
                    }
                    if (bind.mode == 'global' && socket.roomGlobal) {
                        room = socket.roomGlobal;
                    }

                    if (room && bind.cb) {
                        bind.cb(socket, data, room);
                    } else if (room) {
                        if (bind.toMe)
                            io.to(room).emit('binding', data);
                        else
                            socket.to(room).emit('binding', data);
                    }
                }
            });
        });
    })

};

function get_sockets_by_room(room) {
    var resp = [];
    io.sockets.sockets.forEach(function (s) {
        s.rooms.forEach(function (r) {
            if (r === room) {
                resp.push(s);
            }
        })
    });
    return resp;
}

function getBinding(id) {
    var ret;
    bindings.forEach(function (b) {
        if (b.id == id)
            ret = b;
    });
    return ret;
}

/**
 * Bindings: {
 *     id: simplemente el id.
 *     mode: 'session'|'account'|'gobal'
 *     // session es a la session en la misma pc tipicas sessiones web del browser.
 *     // account va solo a la cuenta, por ej cuenta: "santi" a todas logueadas santi en donde sea.
 *     // global a todas las cuentas logueadas.
 *     toMe: envia el evento a mi mismo también.
 *     [cb]: ejecuta un trabajo determinado. cancela cualquier otro emit. params (socket,data,room)
 * }
 * @type {{id: string, mode: string}[]}
 */

var bindings = [
    {id: 'login:name', mode: 'session', toMe: false},
    {id: 'login:userText', mode: 'session', toMe: false},
    {id: 'login:pass', mode: 'session', toMe: false},
    {id: 'user:picture', mode: 'account', toMe: true, cb: function (_, data, room) {

        var type = data.type.replace('image/', '');
        //importante poner el base64 para que decodifique bien.

        var name = uuid.create().value;
        var urlSave = __dirname + '/../public/images/users/' + name + '.' + type;
        fs.writeFile(urlSave, new Buffer(data.data, 'base64'), function (err) {
            if (err) {
                console.log('File could not be saved.', err);
            } else {
                var ancho = 250;
                gm(urlSave)
                    .resize(ancho, ancho + "^>")
                    .gravity('Center')
                    .extent(ancho, ancho)
                    .write(urlSave, function (err) {
                        if (err) {
                            console.log(err);
                        } else {
                            var url = '/images/users/' + name + '.' + type;
                            engine.users.update({name: room},
                                {$set: {profileImg: url}},
                                function (err) {
                                    if (err)
                                        console.log(err);
                                    else {
                                        io.to(room).emit('binding', {id: 'user:picture', url: url });
                                    }
                                });
                        }
                    });


            }
        });
    }},
    {id: 'user:password', mode: 'account', toMe: true, cb: function (_, data, room) {
        d.run(function () {
            engine.users.update(
                {name: room},
                {$set: {password: data.password}},
                function (err, resp) {
                    if (err)
                        console.log(err);
                });

        });
    }},
    {id: 'term:open', mode: 'global', toMe: true, cb: function (socket, data, room) {
        var t = new terminal();
        consolas.push(t);
        var room = io.to('global');
        room.emit('term:open', {pid: t.pid});
    }},
    {id: 'term:close', mode: 'global', toMe: true, cb: function (_, data) {
        consolas.forEach(function (c) {
            if (data.pid === c.pid) {
                c.close();

            }
        });
    }},
    {id: 'term:write', mode: 'global', toMe: true, cb: function (_, data) {
        consolas.forEach(function (c) {
            if (data.pid === c.pid) {
                c.write(data.data);

            }
        });
    }},
    {id: 'comm:get', mode: 'session', toMe: false, cb: function (socket) {
        engine.commands.find({}).toArray(function (err, res) {
            if (err)
                console.log(err);
            else {
                socket.emit('binding', {id: 'comm:get', commands: res});
            }
        });
    }},
    {id: 'comm:save', mode: 'global', toMe: false, cb: function (_, data, room) {
        var cmds = data.value.commands;
        var cb = function (err, resp) {
            if (err)
                console.log(err);
        };
        cmds.forEach(function (it) {
            it['_id'] = new ObjectID(it['_id']);
            if (it.command)
                engine.commands.save(it, {w: 1}, cb);
            else
                engine.commands.remove({_id: it['_id']}, {w: 1}, cb);
        })

    }}
];

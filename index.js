/* This Source Code Form is subject to the terms of the Mozilla Public
 * License, v. 2.0. If a copy of the MPL was not distributed with this
 * file, You can obtain one at http://mozilla.org/MPL/2.0/. */

'use strict';

const async = require('async');
const _ = require('lodash');
const mqtt = require('mqtt');
const debug = require('debug')('mqtt');
const engineUtil = require('artillery/core/lib/engine_util');
const template = engineUtil.template;

function MqttEngine(script) {
  this.config = script.config;
}

// scenarioSpec => All scenario spec, ee => EventEmitter
MqttEngine.prototype.createScenario = function(scenarioSpec, ee) {
  const self = this;

  // rs => Request spec
  let tasks = _.map(scenarioSpec.flow, function(rs) {
    if (rs.think) {
      return engineUtil.createThink(rs, _.get(self.config, 'defaults.think', {}));
    }
    return self.step(rs, ee);
  });

  return self.compile(tasks, scenarioSpec.flow, ee);
};

function markEndTime(ee, context, startedAt) {
  let endedAt = process.hrtime(startedAt);
  let delta = (endedAt[0] * 1e9) + endedAt[1];
  ee.emit('response', delta, 0, context._uid);
}

function isAcknowledgeRequired (spec) {
  return (spec.rpc && spec.acknowledge);
}

function isResponseRequired(spec) {
  return (spec.rpc && spec.response);
}

// RPC based on request id
MqttEngine.prototype.__handleResponse = function (topic, message, packet) {
  // Eko will return in form
  // 41|{ id: 1, p: [err, [response]]}
  try {
    const i = msg.indexOf('|');
    if (i != -1) {
      const responderId = msg.substr(0, i);
      const content = msg.substr(i + 1);

      if (responderId == '41') {
        const json = JSON.parse(content);
        const data = this.responseHandlers[json.id];
        if (data) {
          data.executed = true;
          data.callback(json.p[1]);
        }
      }
    }
  }
  catch (error) {
    console.error('ERROR parsing web socket message', error);
  }
}

// ee => EventEmitter
// data => Received message from server
// response => Acknowledge spec as
//  {
//    data: template(requestSpec.acknowledge.data, context),
//    capture: template(requestSpec.acknowledge.capture, context),
//    match: template(requestSpec.acknowledge.match, context)
//  }
function processResponse(ee, data, response, context, callback) {
  // Do we have supplied data to validate?
  if (response.data && !deepEqual(data, response.data)) {
    debug(data);
    let err = 'data is not valid';
    ee.emit('error', err);
    return callback(err, context);
  }

  // If no capture or match specified, then we consider it a success at this point...
  if (!response.capture && !response.match) {
    return callback(null, context);
  }

  // Construct the (HTTP) response...
  let fauxResponse = {body: JSON.stringify(data)};

  // Handle the capture or match clauses...
  engineUtil.captureOrMatch(response, fauxResponse, context, function(err, result) {
    // Were we unable to invoke captureOrMatch?
    if (err) {
      debug(data);
      ee.emit('error', err);
      return callback(err, context);
    }
    // Do we have any failed matches?
    let failedMatches = _.filter(result.matches, (v, k) => {
      return !v.success;
    });

    // How to handle failed matches?
    if (failedMatches.length > 0) {
      debug(failedMatches);
      // TODO: Should log the details of the match somewhere
      ee.emit('error', 'Failed match');
      return callback(new Error('Failed match'), context);
    } else {
      // Emit match events...
      _.each(result.matches, function(v, k) {
        ee.emit('match', v.success, {
          expected: v.expected,
          got: v.got,
          expression: v.expression
        });
      });

      // Populate the context with captured values
      _.each(result.captures, function(v, k) {
        context.vars[k] = v;
      });

      // Replace the base object context
      // Question: Should this be JSON object or String?
      context.vars.$ = fauxResponse.body;

      // Increment the success count...
      context._successCount++;

      return callback(null, context);
    }
  });
}

MqttEngine.prototype.step = function (requestSpec, ee) {
  let self = this;

  if (requestSpec.loop) {
    let steps = _.map(requestSpec.loop, function(rs) {
      return self.step(rs, ee);
    });

    return engineUtil.createLoopWithCount(
      requestSpec.count || -1,
      steps,
      {
        loopValue: requestSpec.loopValue || '$loopCount',
        overValues: requestSpec.over,
        whileTrue: self.config.processor ?
          self.config.processor[requestSpec.whileTrue] : undefined
      });
  }

  if (requestSpec.think) {
    return engineUtil.createThink(requestSpec, _.get(self.config, 'defaults.think', {}));
  }

  if (requestSpec.log) {
    return function(context, callback) {
      console.log(template(requestSpec.log, context));
      return process.nextTick(function() { callback(null, context); });
    };
  }

  if (requestSpec.close) {
    return function(context, callback) {
      if (context && context.ws) {
        context.ws.close();
      }
      return callback(null, context);
    };
  }

  if (requestSpec.function) {
    return function(context, callback) {
      let processFunc = self.config.processor[requestSpec.function];
      if (processFunc) {
        processFunc(context, ee, function () {
          return callback(null, context);
        });
      }
    }
  }

  const f = function(context, callback) {
    ee.emit('request');
    const startedAt = process.hrtime();
    const ws = context.ws || null;
    const uniqueId = _.uniqueId();

    let params = [];
    if (requestSpec.params) {
      params = _.map(_.values(requestSpec.params), v => {
        return template(v, context);
      });
    }
    const payload = template(`41|{"id":${uniqueId},"m":"${requestSpec.rpc}","p":${JSON.stringify(params)}}`, context);

    const endCallback = function (err, context, needEmit) {
      if (err) {
        debug(err);
      }

      if (isAcknowledgeRequired(requestSpec)) {
        let ackCallback = function () {
          let response = {
            data: template(requestSpec.acknowledge.data, context),
            capture: template(requestSpec.acknowledge.capture, context),
            match: template(requestSpec.acknowledge.match, context)
          };
          // Make sure data, capture or match has a default json spec for parsing socket responses
          _.each(response, function (r) {
            if (_.isPlainObject(r) && !('json' in r)) {
              r.json = '$.0'; // Default to the first callback argument
            }
          });
          // Acknowledge data can take up multiple arguments of the emit callback
          processResponse(ee, arguments, response, context, function (err) {
            if (!err) {
              markEndTime(ee, context, startedAt);
            }
            return callback(err, context);
          });
        }

        // Acknowledge required so add callback to responseHandlers
        self.responseHandlers[uniqueId] = {
          callback: ackCallback,
          executed: false,
          rpc: requestSpec.rpc,
        }
        setTimeout(() => {
          const data = self.responseHandlers[uniqueId];
          const err = `response timeout for ${data.rpc}`;
          if (data && !data.executed) {
            // PUD::Must delete here because return use `return callback` and it will stop there
            delete self.responseHandlers[uniqueId];

            ee.emit('error', err);
            return callback(new Error(err), context);
          }

          delete self.responseHandlers[uniqueId];
        }, self.timeout);
        ws.send(payload);
      } else {
        // No acknowledge data is expected, so just send without register callback
        ws.send(payload);
        markEndTime(ee, context, startedAt);
        return callback(null, context);
      }
    };

    endCallback(null, context, true);

    // PUD:: This is for socketio to listen on the different channel for response
    /*
    if (isResponseRequired(requestSpec)) {
      let response = {
        channel: template(requestSpec.emit.response.channel, context),
        data: template(requestSpec.emit.response.data, context),
        capture: template(requestSpec.emit.response.capture, context),
        match: template(requestSpec.emit.response.match, context)
      };
      // Listen for the socket.io response on the specified channel
      let done = false;
      socketio.on(response.channel, function receive(data) {
        done = true;
        processResponse(ee, data, response, context, function(err) {
          if (!err) {
            markEndTime(ee, context, startedAt);
          }
          // Stop listening on the response channel
          socketio.off(response.channel);
          return endCallback(err, context, false);
        });
      });
      // Send the data on the specified socket.io channel
      socketio.emit(outgoing.channel, outgoing.data);
      // If we don't get a response within the timeout, fire an error
      let waitTime = self.config.timeout || 10;
      waitTime *= 1000;
      setTimeout(function responseTimeout() {
        if (!done) {
          let err = 'response timeout';
          ee.emit('error', err);
          return callback(err, context);
        }
      }, waitTime);
    } else {
      endCallback(null, context, true);
    }
    */
  };

  return f;
};

MqttEngine.prototype.compile = function (tasks, scenarioSpec, ee) {
  const config = this.config;
  this.responseHandlers = {};

  const self = this;

  return function scenario(initialContext, callback) {
    const createMqttClient = function (config, callback) {
      const client = mqtt.connect(config.target);

      client.on('connect', function() {
        initialContext.client = client;
        return callback(null, initialContext);
      });

      client.on('message', function(topic, message, packet) {
        self.__handleResponse(topic, message, packet);
      });

      client.once('error', function(err) {
        debug(err);
        ee.emit('error', err.message || err.code);
        return callback(err, {});
      });
    }

    function zero(callback) {
      ee.emit('started');

      createMqttClient(config, callback);
    }

    initialContext._successCount = 0;

    let steps = _.flatten([
      zero,
      tasks
    ]);

    async.waterfall(
      steps,
      function scenarioWaterfallCb(err, context) {
        if (err) {
          debug(err);
        }

        if (context && context.client) {
          context.client.end();
        }

        return callback(err, context);
      });
  };
};

module.exports = MqttEngine;

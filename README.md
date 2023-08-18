# Artillery MQTT Engine - artillery-engine-mqtt

The **Artillery MQTT Engine** is a custom engine developed for [Artillery](https://artillery.io/), a modern, powerful, and flexible load testing toolkit. This engine enables Artillery to perform load tests using the MQTT (Message Queuing Telemetry Transport) protocol.

## Introduction

The Artillery MQTT Engine, also known as `artillery-engine-mqtt`, is designed to extend the capabilities of Artillery by allowing it to simulate MQTT-based load tests. MQTT is a lightweight and efficient messaging protocol commonly used in IoT (Internet of Things) applications, but it can also be used for various other messaging scenarios.

## Features

The main features of the `artillery-engine-mqtt` project include:

- **beforeScenario / afterScenario Hooks:** You can define functions that will be executed before and after each scenario. This allows you to set up necessary resources before the scenario starts and clean up after the scenario completes.
- **Publish Messages:** The engine allows you to publish MQTT messages to specified topics with custom payloads. This is crucial for simulating realistic messaging patterns in your load tests.
- **Looping with whileTrue:** The engine supports a loop structure called `whileTrue`, which lets you repeat a set of actions while a specified condition remains true. This can be useful for creating dynamic and variable load patterns in your tests.

## Usage

### Configuration

In your Artillery script, you need to specify the `artillery-engine-mqtt` as the engine and provide the necessary MQTT configuration details. Here's an example configuration snippet:

yaml

```yaml
config:
  target: "mqtt://mqtt.example.com:1883"
  engines:
    mqtt: {}
  mqtt:
    clean: true
    protocolVersion: 4
    auth:
      clientId: "my-client-id"
  processor: "./processor.js"
scenarios:
  - flow:
      - loop:
          - publish:
              topic: "sensor/data"
              payload:
                message: "hello"
            whileTrue: "continueLoop"
```

In this example, the `target` field specifies the MQTT broker's URL, and the `engines` section instructs Artillery to use the `artillery-engine-mqtt` for load testing.

## Contributing

Contributions to the `artillery-engine-mqtt` project are welcome! If you have ideas for improvements, bug fixes, or new features, please feel free to open an issue or submit a pull request. Make sure to review the [contribution guidelines](CONTRIBUTING.md) before getting started.

## License

This project is licensed under the [MIT License](LICENSE).

---

**Note:** This README is a template and might not reflect the exact state or features of the `artillery-engine-mqtt` project. Always refer to the actual project repository for the most accurate and up-to-date information.

For more information about Artillery, visit the [official Artillery website](https://artillery.io/).

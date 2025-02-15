/*
 * This class will encapsulate all of the workflow functions specific to BLE 
 */

import {FileTransferClient} from '@adafruit/ble-file-transfer';
import {Workflow, CONNTYPE} from './workflow.js'

const bleNusServiceUUID  = 'adaf0001-4369-7263-7569-74507974686e';
const bleNusCharRXUUID   = 'adaf0002-4369-7263-7569-74507974686e';
const bleNusCharTXUUID   = 'adaf0003-4369-7263-7569-74507974686e';

const BYTES_PER_WRITE = 20;
const loaderId = "ble-loader";
const btnRequestBluetoothDevice = document.querySelector('#requestBluetoothDevice');
const btnBond = document.querySelector('#promptBond');
const btnConnect = document.querySelectorAll('a.btn-connect');

class BLEWorkflow extends Workflow {
    constructor() {
        super();
        this.rxCharacteristic = null;
        this.txCharacteristic = null;
        this.serialService = null;
        this.bleServer = null;
        this.bleDevice = null;
        this.decoder = new TextDecoder();
        this.loadEditor = null;
        this.fileClient = null;
    }

    async init(params) {
        await super.init(params);
        this.loadEditor = params.loadEditorFunc;
        if (navigator.bluetooth) {
            btnRequestBluetoothDevice.addEventListener('click', async function(e) {
                e.preventDefault();
                e.stopPropagation();    
                await this.onRequestBluetoothDeviceButtonClick();
            }.bind(this));
            btnBond.addEventListener('click', async function(e) {
                await this.onBond();
                e.preventDefault();
                e.stopPropagation();    
            }.bind(this));
        
            btnBond.disabled = true;
        } else {
            console.log("bluetooth not supported on this browser");
        }        
    }

    async connectButtonHandler(e) {
        if (this.connectionType == CONNTYPE.Ble) {
            // Disconnect BlueTooth and Reset things
            if (this.bleDevice !== undefined && this.bleDevice.gatt.connected) {
                this.bleDevice.gatt.disconnect();
            }
            this.connectionType == CONNTYPE.None;
            this.disconnect();
        } else {
            try {
                console.log('Getting existing permitted Bluetooth devices...');
                const devices = await navigator.bluetooth.getDevices();

                console.log('> Got ' + devices.length + ' Bluetooth devices.');
                // These devices may not be powered on or in range, so scan for
                // advertisement packets from them before connecting.
                for (const device of devices) {
                    await this.connectToBluetoothDevice(device);
                }
            }
            catch(error) {
                console.log('Argh! ' + error);
            }
        }
    }

    async onBLESerialReceive(e) {
        // console.log("rcv", e.target.value.buffer);
        this.terminal.io.print(this.decoder.decode(e.target.value.buffer, {stream: true}));
    }

    async connectToBLESerial() {
        try {
            this.serialService = await this.bleServer.getPrimaryService(bleNusServiceUUID);
            // TODO: create a terminal for each serial service
            this.txCharacteristic = await this.serialService.getCharacteristic(bleNusCharTXUUID);
            this.rxCharacteristic = await this.serialService.getCharacteristic(bleNusCharRXUUID);
        
            this.txCharacteristic.addEventListener('characteristicvaluechanged', this.onBLESerialReceive.bind(this));
            await this.txCharacteristic.startNotifications();    
        } catch(e) {
            console.log(e, e.stack);
        }
    }

    async connectToBluetoothDevice(device) {
        const abortController = new AbortController();
    
        device.addEventListener('advertisementreceived', async (event) => {
            console.log('> Received advertisement from "' + device.name + '"...');
            // Stop watching advertisements to conserve battery life.
            abortController.abort();
            console.log('Connecting to GATT Server from "' + device.name + '"...');
            try {
                await device.gatt.connect()
                console.log('> Bluetooth device "' +  device.name + ' connected.');
    
                await this.switchToDevice(device);
            }
            catch(error) {
                console.log('Argh! ' + error);
            }
        }, { once: true });
        this.debugLog("connecting to " + device.name);
        try {
            console.log('Watching advertisements from "' + device.name + '"...');
            await device.watchAdvertisements({ signal: abortController.signal });
        }
        catch(error) {
            console.log('Argh! ' + error);
        }
    }

    async switchToDevice(device) {
        this.bleDevice = device;
        this.bleDevice.addEventListener("gattserverdisconnected", this.onDisconnected.bind(this));
        this.bleServer = this.bleDevice.gatt;
        console.log("connected", this.bleServer);
        let services;
    
        try {
            services = await this.bleServer.getPrimaryServices();
        } catch(e) {
            console.log(e, e.stack);
        }
        console.log(services);
    
        console.log('Getting Transfer Service...');
        this.fileClient = new FileTransferClient(this.bleDevice, 65536);
        this.debugLog("connected");
        await this.connectToBLESerial();
    
        btnBond.disabled = false;
        btnConnect.forEach((element) => { element.disabled = true; });
        btnRequestBluetoothDevice.disabled = true;
        await this.loadEditor();
    }

    async onBond() {
        try {
            console.log("bond");
            await this.fileClient.bond();
            console.log("bond done");
        } catch(e) {
            console.log(e, e.stack);
        }
        await this.loadEditor();
    }

    async serialTransmit(msg) {
        if (this.rxCharacteristic) {
            let encoder = new TextEncoder();
            let value = encoder.encode(msg);
            try {
                if (value.byteLength < BYTES_PER_WRITE) {
                    await this.rxCharacteristic.writeValueWithoutResponse(value);
                    return;
                }
                var offset = 0;
                while (offset < value.byteLength) {
                    let len = Math.min(value.byteLength - offset, BYTES_PER_WRITE);
                    let chunk_contents = value.slice(offset, offset + len);
                    console.log("write subarray", offset, chunk_contents);
                    // Delay to ensure the last value was written to the device.
                    await workflow.sleep(100);
                    await this.rxCharacteristic.writeValueWithoutResponse(chunk_contents);
                    offset += len;
                }
            } catch (e) {
                console.log("caught write error", e, e.stack);
            }
        }
    }

    async onRequestBluetoothDeviceButtonClick(e) {
        try {
            console.log('Requesting any Bluetooth device...');
            this.debugLog("Requesting device. Cancel if empty and try existing");
            this.bleDevice = await navigator.bluetooth.requestDevice({
                filters: [{services: [0xfebb]},], // <- Prefer filters to save energy & show relevant devices.
                // acceptAllDevices: true,,
                optionalServices: [0xfebb, bleNusServiceUUID]
            });
    
            console.log('> Requested ' + this.bleDevice.name);
            await this.bleDevice.gatt.connect();
            await this.switchToDevice(this.bleDevice);
        }
        catch(error) {
            console.log('Argh: ' + error);
            this.debugLog('No device selected. Try to connect to existing.');
        }
    }

    async onDisconnected() {
        this.debugLog("disconnected");
        await this.bleServer.connect();
        console.log(this.bleServer.connected);
        this.debugLog("connected");
        await this.connectToBLESerial();
    }

    updateConnected(isConnected) {
        if (isConnected) {
            this.connectionType = CONNTYPE.Ble;
        } else {
            btnBond.disabled = true;
            btnRequestBluetoothDevice.disabled = false;
        }
    }
}

export {loaderId, BLEWorkflow};
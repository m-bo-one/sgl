import * as PIXI from "pixi.js";
import * as io from "socket.io-client";

import { BaseCore, IPlayer, IInput, ILatency, ISnapshot, Direction, CreateBasePlayer, MessageQueue } from "./engine";
import { IKeyboad, createBox, createKey } from "./utils";

class ClientGame extends BaseCore {

    public canvas: HTMLCanvasElement;
    public renderer: PIXI.Application;

    public queue: MessageQueue<ISnapshot>;
    public player: IPlayer;
    public players: {[id: string]: IPlayer};
    public clientPredict: boolean;
    public gameElements: { [key: string]: any };
    public keyboard:  { [direction: number]: IKeyboad };

    private latencyBlock: HTMLElement;
    private io: any;

    constructor(frameTime: number) {
        super(frameTime);
        this.keyboard = {
            [Direction.Down]: createKey(40),
            [Direction.Left]: createKey(37),
            [Direction.Right]: createKey(39),
            [Direction.Up]: createKey(38),
        };
        this.canvas = document.getElementById("sgl") as HTMLCanvasElement;
        this.renderer = new PIXI.Application(800, 600, {
            backgroundColor : 0x1099bb,
            legacy: true,
            view: this.canvas,
        }, true);

        this.player = null;
        this.players = {};
        this.gameElements = {};
        this.clientPredict = true;
        this.showTickRate = false;
        this.queue = new MessageQueue<ISnapshot>();
        this.latencyBlock = document.getElementById("latency");

        this.createSocket();
        this.create();
        this.runLoop();
        this.checkLatency();
    }

    public checkLatency(): void {
        setInterval(() => {
            this.io.emit("latency", <ILatency>{timestamp: Date.now()});
        }, 1000);
    }

    public update(): void {
        if (this.player === null) return;
        // 1) check syncs from server
        this.processServerMessages();
        // 2) process user input and send input to server
        this.handleInputs();
        // 3) rerender map
        this.render();
    }

    public render(): void {
        Object.keys(this.players).forEach(uid => {
            let player: IPlayer = this.players[uid];
            player.canvasEl.x = player.pos.x;
            player.canvasEl.y = player.pos.y;
        });
        this.renderer.render();      
    }

    public processServerMessages(): void {
        while (true) {
            let snapshot: ISnapshot = this.queue.recv();
            if (!snapshot) {
                break;
            }
            for (let playerData of snapshot.players) {
                if (this.players.hasOwnProperty(playerData.id)) {
                    let player: IPlayer = this.players[playerData.id];
                    player.pos = playerData.pos;

                    if (this.clientPredict) {
                        let i: number = 0;
                        while (i < player.inputs.length) {
                            let input: IInput = player.inputs[i];
                            // if already processed from server, remove input
                            if (input.seq <= playerData.lastInputSeq) {
                                player.inputs.splice(i, 1);
                            // reapply it, don't wait server response
                            } else {
                                this.applyInput(player, input);
                                i++;
                            }
                        }
                    } else {
                        // no prediction, wait for server
                        player.inputs = [];
                    }
                } else {
                    this.createPlayer(playerData);
                }
            }     
        }
    }

    public handleInputs(): void {
        let inputs: Direction[] = [];
        for (let direction in Object.keys(this.keyboard)) {
            if (this.keyboard[direction].isDown) {
                inputs.push(parseInt(direction));
            }
        }
        if (inputs.length > 0) {
            this.inputSeq += 1;
            let packet: IInput = {
                seq: this.inputSeq,
                time: Math.floor(Date.now() / 1000),
                inputs: inputs,
            };
            // store for reapplying
            this.player.inputs.push(packet);
            // send packet to server
            setTimeout(() => {
                this.io.emit("input", packet);
            }, 1000);
            // apply local change
            if (this.clientPredict) {
                this.applyInput(this.player, packet);
                this.player.canvasEl.x = this.player.pos.x;
                this.player.canvasEl.y = this.player.pos.y;
            }
        }
    }

    private createPlayer(player: IPlayer) {
        this.players[player.id] = player;
        this.players[player.id].canvasEl = createBox(player.pos.x, player.pos.y, 20, 20);
        this.renderer.stage.addChild(this.players[player.id].canvasEl);
        return this.players[player.id];
    }

    private removePlayer(player: IPlayer) {
        this.renderer.stage.removeChild(this.players[player.id].canvasEl);
        delete this.players[player.id]
    }

    private createSocket(): void {
        this.io = io("http://localhost:9001");
        this.io.on("connect", () => {
            Object.keys(this.players).forEach(uid => {
                let player: IPlayer = this.players[uid];
                this.removePlayer(player);
            });
            console.log("open");
        });
        this.io.on("message", (data: any) => {
            console.log(data);
        });
        this.io.on("login", (player: IPlayer) => {
            this.player = this.createPlayer(player);
        });
        this.io.on("logout", (player: IPlayer) => {
            this.removePlayer(player);
        });
        this.io.on("mapUpdate", (snapshot: ISnapshot) => {
            this.queue.send(snapshot);
        });
        this.io.on("latency", (data: any) => {
            let delta: number = data.timestamp - data.processed;
            this.latencyBlock.innerHTML = `Latency: ${delta}`;
        });
        this.io.on("disconnect", () => {
            console.log("closed");
        });
    }

    private create(): void {

    }
}

(window as any).MainGame = new ClientGame(60);

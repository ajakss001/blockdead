import type { GunId } from '../weapons/guns';
import type { GunPoses } from './gunPose';

/** Written by `node tools/vite-run.mjs src/debug/gunTune.ts <gun|all> [rounds] --write`: per-gun overrides of the class poses. */
export const GUN_TUNED: Partial<Record<GunId, Partial<GunPoses>>> = {
  pistol_g17: {
    hip: [
      0.066,
      -0.176,
      -0.488
    ],
    converge: 8,
    relief: 0.53,
    adsDrop: 0,
    sprint: {
      at: [
        0.155,
        -0.325,
        -0.325
      ],
      turn: [
        0.15,
        0.225,
        0.825
      ]
    },
    wall: {
      at: [
        0.11,
        -0.24,
        -0.31
      ],
      turn: [
        1.2,
        0,
        0.45
      ]
    },
    reload: {
      at: [
        0.02,
        -0.242,
        -0.35
      ],
      turn: [
        0.3,
        0.693,
        -0.45
      ]
    },
    lowered: {
      at: [
        0.165,
        -0.605,
        -0.19
      ],
      turn: [
        -0.225,
        -0.175,
        0.375
      ]
    },
    inspectA: {
      at: [
        0.11,
        -0.24,
        -0.36
      ],
      turn: [
        0.825,
        -0.5,
        0.5
      ]
    },
    inspectB: {
      at: [
        0.03,
        -0.22,
        -0.45
      ],
      turn: [
        0.875,
        0.15,
        -0.05
      ]
    },
    bash: {
      at: [
        0.178,
        -0.195,
        -0.365
      ],
      turn: [
        0.238,
        0.175,
        0.275
      ]
    },
    crouch: -0.015,
    pouch: [
      -0.07,
      -0.485,
      -0.375
    ],
    mainRoll: 0.751,
    offRoll: -0.799,
    magRoll: -1.575,
    boltRoll: 0.06,
    loadRoll: -0.16,
    offShift: [
      0.029,
      0.03,
      0.008
    ],
    offTilt: -1.33,
    shoulderR: [
      -0.01,
      0.09,
      0.02
    ],
    shoulderL: [
      0,
      -0.02,
      0
    ],
    adsShoulderR: [
      -0.01,
      0.1,
      -0.03
    ],
    adsShoulderL: [
      0.1,
      0.07,
      0
    ],
    adsMainRoll: 0.022,
    adsOffRoll: 0.9
  },
  shotgun_pump: {
    hip: [
      0.198,
      -0.195,
      -0.161
    ],
    converge: 12,
    relief: 0.29,
    adsDrop: 0.02,
    sprint: {
      at: [
        0.254,
        -0.39,
        -0.195
      ],
      turn: [
        0.625,
        0.35,
        0.2
      ]
    },
    wall: {
      at: [
        0.161,
        -0.362,
        -0.1
      ],
      turn: [
        0.378,
        0.663,
        0
      ]
    },
    reload: {
      at: [
        0.207,
        -0.451,
        -0.076
      ],
      turn: [
        -0.038,
        0.954,
        -0.426
      ]
    },
    lowered: {
      at: [
        0.215,
        -0.51,
        -0.046
      ],
      turn: [
        0.014,
        0.419,
        -0.343
      ]
    },
    inspectA: {
      at: [
        0.205,
        -0.332,
        -0.075
      ],
      turn: [
        0.084,
        0.35,
        0.425
      ]
    },
    inspectB: {
      at: [
        0.184,
        -0.354,
        -0.17
      ],
      turn: [
        0.749,
        0.304,
        -0.145
      ]
    },
    bash: {
      at: [
        0.23,
        -0.27,
        -0.17
      ],
      turn: [
        0.428,
        0.348,
        0.921
      ]
    },
    crouch: -0.02,
    pouch: [
      0.221,
      -0.209,
      -0.053
    ],
    mainRoll: 0,
    offRoll: -0.355,
    magRoll: -1.347,
    boltRoll: 0.219,
    loadRoll: 0.975,
    offShift: [
      0.047,
      -0.078,
      0.175
    ],
    offTilt: -1.452,
    shoulderR: [
      -0.094,
      0.114,
      -0.039
    ],
    shoulderL: [
      -0.046,
      0.061,
      -0.094
    ],
    adsShoulderR: [
      -0.209,
      0.103,
      0.009
    ],
    adsShoulderL: [
      -0.063,
      0.09,
      -0.07
    ],
    adsMainRoll: -0.27,
    adsOffRoll: 0.485
  },
  rifle_hunting: {
    hip: [
      0.162,
      -0.196,
      -0.161
    ],
    converge: 12,
    relief: 0.337,
    adsDrop: 0.02,
    sprint: {
      at: [
        0.215,
        -0.432,
        -0.175
      ],
      turn: [
        0.15,
        0.575,
        -0.55
      ]
    },
    wall: {
      at: [
        0.207,
        -0.328,
        -0.159
      ],
      turn: [
        0.076,
        0.046,
        -0.364
      ]
    },
    reload: {
      at: [
        0.222,
        -0.368,
        -0.093
      ],
      turn: [
        0.014,
        1.109,
        -0.22
      ]
    },
    lowered: {
      at: [
        0.345,
        -0.566,
        -0.028
      ],
      turn: [
        -0.197,
        0.61,
        -0.4
      ]
    },
    inspectA: {
      at: [
        0.215,
        -0.36,
        -0.175
      ],
      turn: [
        0.775,
        0.65,
        0.175
      ]
    },
    inspectB: {
      at: [
        0.234,
        -0.416,
        -0.09
      ],
      turn: [
        -0.022,
        0.085,
        -0.425
      ]
    },
    bash: {
      at: [
        0.279,
        -0.323,
        -0.201
      ],
      turn: [
        0.494,
        0.4,
        0.706
      ]
    },
    crouch: -0.02,
    pouch: [
      0.3,
      -0.338,
      0.006
    ],
    mainRoll: 0,
    offRoll: -0.776,
    magRoll: -1.552,
    boltRoll: 0.277,
    loadRoll: 0.987,
    offShift: [
      0.114,
      -0.039,
      0.197
    ],
    offTilt: -1.908,
    shoulderR: [
      -0.051,
      0.102,
      -0.066
    ],
    shoulderL: [
      0.016,
      0.06,
      -0.08
    ],
    adsShoulderR: [
      -0.155,
      0.075,
      0.068
    ],
    adsShoulderL: [
      0.099,
      0.095,
      0.1
    ],
    adsMainRoll: -2.06,
    adsOffRoll: -0.494
  },
  pistol_m1911: {
    hip: [
      0.057,
      -0.17,
      -0.398
    ],
    converge: 8,
    relief: 0.517,
    adsDrop: 0,
    sprint: {
      at: [
        0.018,
        -0.295,
        -0.309
      ],
      turn: [
        0.175,
        1.118,
        0.5
      ]
    },
    wall: {
      at: [
        0.112,
        -0.019,
        -0.25
      ],
      turn: [
        0.967,
        0.6,
        0
      ]
    },
    reload: {
      at: [
        0.055,
        -0.21,
        -0.415
      ],
      turn: [
        -0.005,
        0.494,
        -0.452
      ]
    },
    lowered: {
      at: [
        0.323,
        -0.46,
        -0.265
      ],
      turn: [
        -0.262,
        0.6,
        0.525
      ]
    },
    inspectA: {
      at: [
        0.238,
        -0.164,
        -0.47
      ],
      turn: [
        0.205,
        0.224,
        1.046
      ]
    },
    inspectB: {
      at: [
        0.044,
        -0.154,
        -0.345
      ],
      turn: [
        0.413,
        0.818,
        0.368
      ]
    },
    bash: {
      at: [
        0.255,
        -0.21,
        -0.44
      ],
      turn: [
        0.326,
        0.875,
        0.35
      ]
    },
    crouch: -0.015,
    pouch: [
      0.044,
      -0.483,
      -0.344
    ],
    mainRoll: -0.698,
    offRoll: -0.998,
    magRoll: -1.002,
    boltRoll: 0.965,
    loadRoll: 0.661,
    offShift: [
      0.03,
      0.069,
      0.016
    ],
    offTilt: -1.009,
    shoulderR: [
      0.01,
      0.095,
      0.092
    ],
    shoulderL: [
      0.019,
      0.039,
      0.086
    ],
    adsShoulderR: [
      -0.052,
      0.096,
      -0.081
    ],
    adsShoulderL: [
      0.061,
      0.092,
      -0.049
    ],
    adsMainRoll: 0,
    adsOffRoll: 0.395
  },
  launcher_rpg: {
    hip: [
      0.042,
      -0.184,
      -0.105
    ],
    converge: 20,
    relief: 0.272,
    adsDrop: 0,
    sprint: {
      at: [
        -0.045,
        -0.19,
        -0.1
      ],
      turn: [
        0.1,
        0.25,
        0
      ]
    },
    wall: {
      at: [
        0.075,
        -0.14,
        -0.07
      ],
      turn: [
        1.175,
        0.375,
        0.15
      ]
    },
    reload: {
      at: [
        0.105,
        -0.216,
        0.009
      ],
      turn: [
        0.123,
        0.924,
        0.029
      ]
    },
    lowered: {
      at: [
        0.146,
        -0.345,
        -0.155
      ],
      turn: [
        -0.5,
        0.05,
        0.075
      ]
    },
    inspectA: {
      at: [
        0.056,
        -0.12,
        -0.19
      ],
      turn: [
        0.55,
        -0.15,
        -0.2
      ]
    },
    inspectB: {
      at: [
        -0.03,
        -0.19,
        -0.19
      ],
      turn: [
        0.7,
        0.35,
        0.2
      ]
    },
    bash: {
      at: [
        -0.045,
        -0.15,
        -0.25
      ],
      turn: [
        0.7,
        -0.05,
        0.1
      ]
    },
    crouch: -0.02,
    pouch: [
      0.093,
      -0.264,
      0.035
    ],
    mainRoll: 0,
    offRoll: -0.698,
    magRoll: 0.311,
    boltRoll: -0.068,
    loadRoll: 0.54,
    offShift: [
      0.076,
      -0.068,
      0.012
    ],
    offTilt: 0.61,
    shoulderR: [
      0.047,
      0.084,
      0.017
    ],
    shoulderL: [
      -0.076,
      0.062,
      0
    ],
    adsShoulderR: [
      0.078,
      0.092,
      -0.037
    ],
    adsShoulderL: [
      -0.045,
      0.064,
      -0.024
    ],
    adsMainRoll: 0,
    adsOffRoll: 0
  },
  rifle_m4a1: {
    hip: [
      0.199,
      -0.189,
      -0.167
    ],
    converge: 12,
    relief: 0.28,
    adsDrop: 0.02,
    sprint: {
      at: [
        0.188,
        -0.47,
        -0.145
      ],
      turn: [
        -0.318,
        0.95,
        -0.1
      ]
    },
    wall: {
      at: [
        0.133,
        -0.309,
        -0.25
      ],
      turn: [
        0.988,
        0.63,
        0.475
      ]
    },
    reload: {
      at: [
        0.151,
        -0.414,
        -0.164
      ],
      turn: [
        0.272,
        0.582,
        -0.633
      ]
    },
    lowered: {
      at: [
        0.218,
        -0.48,
        -0.103
      ],
      turn: [
        -0.3,
        0.488,
        -0.262
      ]
    },
    inspectA: {
      at: [
        0.175,
        -0.33,
        -0.082
      ],
      turn: [
        -0.29,
        0.175,
        0.125
      ]
    },
    inspectB: {
      at: [
        0.054,
        -0.466,
        -0.126
      ],
      turn: [
        0.288,
        0.212,
        -0.763
      ]
    },
    bash: {
      at: [
        0.195,
        -0.296,
        -0.298
      ],
      turn: [
        0.837,
        0.597,
        0.359
      ]
    },
    crouch: -0.02,
    pouch: [
      0.093,
      -0.443,
      -0.092
    ],
    mainRoll: 0,
    offRoll: -1.396,
    magRoll: -0.881,
    boltRoll: 0.596,
    loadRoll: 0.548,
    offShift: [
      -0.007,
      0.075,
      0.156
    ],
    offTilt: -1.623,
    shoulderR: [
      -0.099,
      0.109,
      -0.04
    ],
    shoulderL: [
      0.004,
      0.098,
      0.005
    ],
    adsShoulderR: [
      -0.098,
      0.048,
      0.05
    ],
    adsShoulderL: [
      0.09,
      0.091,
      -0.01
    ],
    adsMainRoll: 1.705,
    adsOffRoll: 0.128
  },
  rifle_ak: {
    hip: [
      0.191,
      -0.189,
      -0.226
    ],
    converge: 12,
    relief: 0.293,
    adsDrop: 0.02,
    sprint: {
      at: [
        0.243,
        -0.467,
        -0.147
      ],
      turn: [
        -0.498,
        0.427,
        -0.16
      ]
    },
    wall: {
      at: [
        0.14,
        -0.356,
        -0.255
      ],
      turn: [
        0.967,
        1.09,
        0.536
      ]
    },
    reload: {
      at: [
        0.215,
        -0.427,
        -0.147
      ],
      turn: [
        0.242,
        0.743,
        -0.296
      ]
    },
    lowered: {
      at: [
        0.174,
        -0.558,
        -0.007
      ],
      turn: [
        -0.776,
        0.482,
        -0.487
      ]
    },
    inspectA: {
      at: [
        0.193,
        -0.417,
        -0.095
      ],
      turn: [
        0.143,
        0.087,
        -0.238
      ]
    },
    inspectB: {
      at: [
        0.177,
        -0.384,
        -0.094
      ],
      turn: [
        0.112,
        0.009,
        -0.387
      ]
    },
    bash: {
      at: [
        0.217,
        -0.28,
        -0.295
      ],
      turn: [
        0.063,
        0.578,
        -0.262
      ]
    },
    crouch: -0.02,
    pouch: [
      0.249,
      -0.248,
      -0.16
    ],
    mainRoll: 0,
    offRoll: -0.747,
    magRoll: -0.81,
    boltRoll: 0.58,
    loadRoll: 0.905,
    offShift: [
      -0.002,
      0.013,
      0.248
    ],
    offTilt: -1.05,
    shoulderR: [
      -0.099,
      0.099,
      -0.075
    ],
    shoulderL: [
      -0.012,
      0.054,
      0.01
    ],
    adsShoulderR: [
      -0.149,
      0.1,
      -0.041
    ],
    adsShoulderL: [
      -0.092,
      0.1,
      0.043
    ],
    adsMainRoll: 0.821,
    adsOffRoll: 0.075
  }
};

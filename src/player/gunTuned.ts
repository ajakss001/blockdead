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
        0.065,
        -0.27,
        -0.31
      ],
      turn: [
        0.75,
        0,
        0.3
      ]
    },
    reload: {
      at: [
        -0.055,
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
        0.12,
        -0.575,
        -0.28
      ],
      turn: [
        -0.675,
        -0.175,
        0.375
      ]
    },
    inspectA: {
      at: [
        0.08,
        -0.27,
        -0.39
      ],
      turn: [
        0.375,
        -0.05,
        0.05
      ]
    },
    inspectB: {
      at: [
        0.045,
        -0.22,
        -0.45
      ],
      turn: [
        0.8,
        0.15,
        -0.05
      ]
    },
    bash: {
      at: [
        0.268,
        -0.285,
        -0.365
      ],
      turn: [
        0.538,
        -0.275,
        -0.025
      ]
    },
    crouch: -0.015,
    pouch: [
      -0.02,
      -0.435,
      -0.325
    ],
    mainRoll: 0.751,
    offRoll: -0.649,
    magRoll: -1.125,
    boltRoll: 0.81,
    loadRoll: -0.16,
    offShift: [
      0.029,
      0.03,
      0.008
    ],
    offTilt: -1.18,
    shoulderR: [
      0.05,
      0.03,
      0
    ],
    shoulderL: [
      0.03,
      -0.03,
      -0.03
    ],
    adsShoulderR: [
      0,
      0.1,
      -0.01
    ],
    adsShoulderL: [
      0.07,
      0.1,
      -0.01
    ],
    adsMainRoll: -0.128,
    adsOffRoll: 0.6
  },
  shotgun_pump: {
    hip: [
      0.133,
      -0.106,
      -0.227
    ],
    converge: 12,
    relief: 0.38,
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
        0.063,
        -0.282,
        -0.1
      ],
      turn: [
        0.269,
        0.678,
        -0.75
      ]
    },
    reload: {
      at: [
        0.2,
        -0.406,
        -0.051
      ],
      turn: [
        0.03,
        0.939,
        -0.301
      ]
    },
    lowered: {
      at: [
        0.141,
        -0.143,
        0.039
      ],
      turn: [
        0.157,
        0.562,
        -1.418
      ]
    },
    inspectA: {
      at: [
        0.141,
        -0.18,
        0.025
      ],
      turn: [
        0.647,
        0.607,
        -1.2
      ]
    },
    inspectB: {
      at: [
        0.124,
        -0.225,
        -0.028
      ],
      turn: [
        0.46,
        0.698,
        -0.87
      ]
    },
    bash: {
      at: [
        0.192,
        -0.238,
        -0.051
      ],
      turn: [
        0.066,
        0.171,
        -0.754
      ]
    },
    crouch: -0.02,
    pouch: [
      0.342,
      -0.164,
      -0.062
    ],
    mainRoll: -3.142,
    offRoll: -0.2,
    magRoll: -0.572,
    boltRoll: 0.011,
    loadRoll: 0.8,
    offShift: [
      0.07,
      -0.073,
      0.158
    ],
    offTilt: -0.802,
    shoulderR: [
      0.003,
      0.064,
      0.08
    ],
    shoulderL: [
      -0.086,
      0.052,
      -0.1
    ],
    adsShoulderR: [
      -0.047,
      0.098,
      0.099
    ],
    adsShoulderL: [
      -0.1,
      0.1,
      -0.1
    ],
    adsMainRoll: 0.83,
    adsOffRoll: -0.075
  },
  rifle_hunting: {
    hip: [
      0.162,
      -0.156,
      -0.182
    ],
    converge: 12,
    relief: 0.414,
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
        0.115,
        -0.388,
        -0.084
      ],
      turn: [
        0.564,
        0.339,
        -0.589
      ]
    },
    reload: {
      at: [
        0.418,
        -0.32,
        0.009
      ],
      turn: [
        0.77,
        0.707,
        0.506
      ]
    },
    lowered: {
      at: [
        0.062,
        -0.432,
        0.04
      ],
      turn: [
        0.814,
        0.875,
        -0.65
      ]
    },
    inspectA: {
      at: [
        0.05,
        -0.43,
        -0.011
      ],
      turn: [
        0.98,
        1.055,
        -0.704
      ]
    },
    inspectB: {
      at: [
        0.083,
        -0.371,
        -0.045
      ],
      turn: [
        0.741,
        0.66,
        -0.712
      ]
    },
    bash: {
      at: [
        0.103,
        -0.279,
        -0.156
      ],
      turn: [
        0.374,
        0.542,
        -0.041
      ]
    },
    crouch: -0.02,
    pouch: [
      0.15,
      -0.188,
      -0.123
    ],
    mainRoll: 0.251,
    offRoll: 2.943,
    magRoll: -1.062,
    boltRoll: 0.277,
    loadRoll: 0.972,
    offShift: [
      0.136,
      -0.029,
      0.272
    ],
    offTilt: -2.08,
    shoulderR: [
      -0.098,
      0.096,
      -0.04
    ],
    shoulderL: [
      -0.042,
      0.072,
      -0.1
    ],
    adsShoulderR: [
      -0.1,
      -0.098,
      -0.024
    ],
    adsShoulderL: [
      0.099,
      0.095,
      0.1
    ],
    adsMainRoll: -2.52,
    adsOffRoll: -0.844
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
        0.082,
        -0.019,
        -0.31
      ],
      turn: [
        0.967,
        0.15,
        -0.15
      ]
    },
    reload: {
      at: [
        0.055,
        -0.21,
        -0.415
      ],
      turn: [
        -0.155,
        0.494,
        -0.452
      ]
    },
    lowered: {
      at: [
        0.233,
        -0.43,
        -0.235
      ],
      turn: [
        -0.262,
        0.15,
        0.525
      ]
    },
    inspectA: {
      at: [
        0.148,
        -0.254,
        -0.47
      ],
      turn: [
        -0.245,
        0.074,
        1.046
      ]
    },
    inspectB: {
      at: [
        -0.046,
        -0.184,
        -0.315
      ],
      turn: [
        -0.037,
        0.368,
        0.218
      ]
    },
    bash: {
      at: [
        0.165,
        -0.12,
        -0.38
      ],
      turn: [
        -0.124,
        0.425,
        0.35
      ]
    },
    crouch: -0.015,
    pouch: [
      0.094,
      -0.633,
      -0.344
    ],
    mainRoll: -0.698,
    offRoll: -1.598,
    magRoll: -0.102,
    boltRoll: 0.665,
    loadRoll: 0.661,
    offShift: [
      0.03,
      0.069,
      0.016
    ],
    offTilt: -1.009,
    shoulderR: [
      0.07,
      0.035,
      0.032
    ],
    shoulderL: [
      0.079,
      0.019,
      0.026
    ],
    adsShoulderR: [
      -0.052,
      0.096,
      -0.061
    ],
    adsShoulderL: [
      0.061,
      0.092,
      -0.049
    ],
    adsMainRoll: 0,
    adsOffRoll: -0.505
  },
  launcher_rpg: {
    hip: [
      0.042,
      -0.154,
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
        0.19,
        -0.202,
        -0.042
      ],
      turn: [
        1.402,
        0.9,
        -0.525
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
        -0.019,
        -0.472,
        -0.242
      ],
      turn: [
        -0.462,
        -0.062,
        0.375
      ]
    },
    inspectA: {
      at: [
        0.176,
        -0.32,
        -0.22
      ],
      turn: [
        0.202,
        -0.333,
        -0.055
      ]
    },
    inspectB: {
      at: [
        -0.039,
        -0.239,
        -0.354
      ],
      turn: [
        0.025,
        -0.55,
        0.025
      ]
    },
    bash: {
      at: [
        -0.122,
        -0.305,
        -0.422
      ],
      turn: [
        0.275,
        -0.312,
        -0.091
      ]
    },
    crouch: -0.02,
    pouch: [
      0.417,
      -0.315,
      0.025
    ],
    mainRoll: -2.793,
    offRoll: -1.047,
    magRoll: 0.161,
    boltRoll: -0.368,
    loadRoll: 1.55,
    offShift: [
      0.076,
      -0.068,
      0.012
    ],
    offTilt: 0.61,
    shoulderR: [
      0.054,
      0.084,
      0.004
    ],
    shoulderL: [
      -0.068,
      -0.038,
      0.081
    ],
    adsShoulderR: [
      0.096,
      0.092,
      -0.037
    ],
    adsShoulderL: [
      -0.005,
      0.084,
      0.006
    ],
    adsMainRoll: 0.6,
    adsOffRoll: 0.715
  },
  rifle_m4a1: {
    hip: [
      0.184,
      -0.156,
      -0.229
    ],
    converge: 12,
    relief: 0.27,
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
        0.008,
        -0.297,
        -0.141
      ],
      turn: [
        0.737,
        1.014,
        0.346
      ]
    },
    reload: {
      at: [
        0.231,
        -0.356,
        -0.198
      ],
      turn: [
        0.191,
        1.461,
        -0.093
      ]
    },
    lowered: {
      at: [
        0.199,
        -0.345,
        -0.08
      ],
      turn: [
        0.074,
        0.638,
        -0.762
      ]
    },
    inspectA: {
      at: [
        0.179,
        -0.343,
        -0.076
      ],
      turn: [
        0.092,
        0.776,
        -0.462
      ]
    },
    inspectB: {
      at: [
        0.183,
        -0.341,
        -0.126
      ],
      turn: [
        0.288,
        0.499,
        -0.776
      ]
    },
    bash: {
      at: [
        0.111,
        -0.395,
        -0.135
      ],
      turn: [
        0.087,
        0.897,
        -0.516
      ]
    },
    crouch: -0.02,
    pouch: [
      0.048,
      -0.387,
      -0.052
    ],
    mainRoll: -2.094,
    offRoll: 0,
    magRoll: -0.868,
    boltRoll: 0.353,
    loadRoll: -0.052,
    offShift: [
      0.01,
      0.065,
      0.154
    ],
    offTilt: -0.956,
    shoulderR: [
      -0.043,
      0.062,
      0.046
    ],
    shoulderL: [
      0.018,
      0.094,
      -0.08
    ],
    adsShoulderR: [
      0.03,
      0.073,
      0.066
    ],
    adsShoulderL: [
      0.028,
      0.098,
      -0.1
    ],
    adsMainRoll: 1.111,
    adsOffRoll: -0.472
  },
  rifle_ak: {
    hip: [
      0.168,
      -0.119,
      -0.192
    ],
    converge: 12,
    relief: 0.279,
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
        0.027,
        -0.299,
        -0.12
      ],
      turn: [
        0.062,
        1.14,
        0.086
      ]
    },
    reload: {
      at: [
        0.178,
        -0.432,
        -0.162
      ],
      turn: [
        0.647,
        1.146,
        0.169
      ]
    },
    lowered: {
      at: [
        0.02,
        -0.477,
        -0.127
      ],
      turn: [
        -0.963,
        0.597,
        -0.562
      ]
    },
    inspectA: {
      at: [
        0.19,
        -0.261,
        -0.072
      ],
      turn: [
        0.451,
        -0.313,
        -0.548
      ]
    },
    inspectB: {
      at: [
        0.227,
        -0.336,
        -0.084
      ],
      turn: [
        0.255,
        -0.116,
        -0.574
      ]
    },
    bash: {
      at: [
        0.122,
        -0.362,
        -0.169
      ],
      turn: [
        0.282,
        0.728,
        -0.262
      ]
    },
    crouch: -0.02,
    pouch: [
      0.191,
      -0.218,
      -0.154
    ],
    mainRoll: -1.045,
    offRoll: 2.444,
    magRoll: -0.799,
    boltRoll: 0.408,
    loadRoll: 1.491,
    offShift: [
      -0.014,
      0.005,
      0.186
    ],
    offTilt: -0.646,
    shoulderR: [
      -0.087,
      0.064,
      0.024
    ],
    shoulderL: [
      -0.044,
      0.074,
      -0.097
    ],
    adsShoulderR: [
      -0.066,
      0.099,
      0.013
    ],
    adsShoulderL: [
      -0.099,
      0.1,
      -0.099
    ],
    adsMainRoll: 1.571,
    adsOffRoll: -0.31
  }
};

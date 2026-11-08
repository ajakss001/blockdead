import type { GunId } from '../weapons/guns';
import type { GunPoses } from './gunPose';

/** Written by `node tools/vite-run.mjs src/debug/gunTune.ts <gun|all> [rounds] --write`: per-gun overrides of the class poses. */
export const GUN_TUNED: Partial<Record<GunId, Partial<GunPoses>>> = {
  pistol_g17: {
    hip: [
      0.081,
      -0.174,
      -0.337
    ],
    converge: 8,
    relief: 0.779,
    adsDrop: 0,
    sprint: {
      at: [
        0.304,
        0.04,
        -0.377
      ],
      turn: [
        -1.2,
        -0.122,
        1.055
      ]
    },
    wall: {
      at: [
        -0.028,
        -0.062,
        -0.109
      ],
      turn: [
        1.163,
        -0.08,
        0.708
      ]
    },
    reload: {
      at: [
        0.301,
        -0.177,
        -0.424
      ],
      turn: [
        1.203,
        -0.23,
        1.393
      ]
    },
    lowered: {
      at: [
        0.144,
        -0.197,
        -0.12
      ],
      turn: [
        0.173,
        0.05,
        0.34
      ]
    },
    inspectA: {
      at: [
        0.073,
        -0.098,
        -0.052
      ],
      turn: [
        1.455,
        0.573,
        0.12
      ]
    },
    inspectB: {
      at: [
        0.181,
        -0.247,
        -0.408
      ],
      turn: [
        0.507,
        0.628,
        -0.962
      ]
    },
    bash: {
      at: [
        0.279,
        -0.115,
        -0.51
      ],
      turn: [
        -0.33,
        0.318,
        0.753
      ]
    },
    crouch: -0.015,
    pouch: [
      0.07,
      -0.441,
      0.131
    ],
    mainRoll: 2.045,
    offRoll: 0,
    magRoll: 0.71,
    boltRoll: 0.405,
    loadRoll: -0.375,
    offShift: [
      0.13,
      -0.076,
      -0.119
    ],
    offTilt: -0.36,
    shoulderR: [
      0.066,
      0.041,
      -0.013
    ],
    shoulderL: [
      0.041,
      0.089,
      0.07
    ],
    adsShoulderR: [
      -0.08,
      -0.041,
      -0.098
    ],
    adsShoulderL: [
      0.027,
      0.084,
      -0.003
    ],
    adsMainRoll: -0.4,
    adsOffRoll: 0.035
  },
  shotgun_pump: {
    hip: [
      0.118,
      -0.14,
      -0.212
    ],
    converge: 12,
    relief: 0.214,
    adsDrop: 0.02,
    sprint: {
      at: [
        0.08,
        -0.26,
        -0.22
      ],
      turn: [
        -0.4,
        0.5,
        -0.25
      ]
    },
    wall: {
      at: [
        0.215,
        -0.265,
        -0.124
      ],
      turn: [
        0.4,
        -0.425,
        0.035
      ]
    },
    reload: {
      at: [
        0.156,
        -0.224,
        -0.218
      ],
      turn: [
        0.5,
        0.263,
        0.175
      ]
    },
    lowered: {
      at: [
        -0.06,
        -0.56,
        -0.015
      ],
      turn: [
        -0.6,
        0.075,
        -0.51
      ]
    },
    inspectA: {
      at: [
        0.142,
        -0.37,
        -0.135
      ],
      turn: [
        0.325,
        -0.55,
        -0.475
      ]
    },
    inspectB: {
      at: [
        0.157,
        -0.336,
        -0.18
      ],
      turn: [
        0.63,
        -0.513,
        -0.53
      ]
    },
    bash: {
      at: [
        0.218,
        -0.35,
        -0.29
      ],
      turn: [
        0,
        0.175,
        -0.475
      ]
    },
    crouch: -0.02,
    pouch: [
      0.196,
      -0.41,
      -0.125
    ],
    mainRoll: 1.247,
    offRoll: -0.466,
    magRoll: -0.645,
    boltRoll: 0.61,
    loadRoll: 0.6,
    offShift: [
      -0.005,
      -0.019,
      -0.055
    ],
    offTilt: 0.28,
    shoulderR: [
      -0.083,
      0.086,
      -0.058
    ],
    shoulderL: [
      -0.015,
      0.097,
      -0.1
    ],
    adsShoulderR: [
      -0.058,
      0.099,
      0.001
    ],
    adsShoulderL: [
      -0.023,
      0.072,
      -0.066
    ],
    adsMainRoll: 0.91,
    adsOffRoll: -0.23
  },
  rifle_hunting: {
    hip: [
      0.143,
      -0.153,
      -0.239
    ],
    converge: 12,
    relief: 0.215,
    adsDrop: 0.02,
    sprint: {
      at: [
        -0.01,
        -0.26,
        -0.25
      ],
      turn: [
        -0.4,
        0.5,
        -0.4
      ]
    },
    wall: {
      at: [
        0.125,
        -0.295,
        -0.128
      ],
      turn: [
        0.55,
        -0.35,
        -0.3
      ]
    },
    reload: {
      at: [
        0.118,
        -0.257,
        -0.212
      ],
      turn: [
        0.238,
        0.541,
        -0.3
      ]
    },
    lowered: {
      at: [
        0.113,
        -0.487,
        -0.09
      ],
      turn: [
        -0.008,
        0,
        0
      ]
    },
    inspectA: {
      at: [
        0.17,
        -0.255,
        -0.135
      ],
      turn: [
        0.075,
        -0.4,
        0.125
      ]
    },
    inspectB: {
      at: [
        0.105,
        -0.265,
        -0.18
      ],
      turn: [
        0.225,
        0.1,
        -0.125
      ]
    },
    bash: {
      at: [
        0.19,
        -0.201,
        -0.244
      ],
      turn: [
        0.06,
        0.235,
        0.06
      ]
    },
    crouch: -0.02,
    pouch: [
      0.134,
      -0.236,
      0.068
    ],
    mainRoll: -2.942,
    offRoll: -3.027,
    magRoll: -0.05,
    boltRoll: -0.1,
    loadRoll: 0.38,
    offShift: [
      -0.035,
      0.033,
      0.019
    ],
    offTilt: -0.162,
    shoulderR: [
      -0.016,
      0.081,
      0.045
    ],
    shoulderL: [
      -0.005,
      0.024,
      0.005
    ],
    adsShoulderR: [
      -0.051,
      0.093,
      -0.015
    ],
    adsShoulderL: [
      -0.067,
      0.1,
      -0.101
    ],
    adsMainRoll: 1.16,
    adsOffRoll: 0.7
  },
  pistol_m1911: {
    hip: [
      0.153,
      -0.125,
      -0.466
    ],
    converge: 8,
    relief: 0.548,
    adsDrop: 0,
    sprint: {
      at: [
        0.134,
        -0.215,
        -0.34
      ],
      turn: [
        -1.463,
        1.108,
        0.105
      ]
    },
    wall: {
      at: [
        0.294,
        -0.067,
        -0.225
      ],
      turn: [
        0.94,
        0.245,
        0.778
      ]
    },
    reload: {
      at: [
        0.126,
        -0.066,
        -0.126
      ],
      turn: [
        0.275,
        0.56,
        -0.195
      ]
    },
    lowered: {
      at: [
        0.244,
        -0.362,
        -0.18
      ],
      turn: [
        -0.57,
        0.485,
        0.388
      ]
    },
    inspectA: {
      at: [
        0.118,
        -0.08,
        -0.288
      ],
      turn: [
        0.565,
        0.063,
        0.82
      ]
    },
    inspectB: {
      at: [
        0.153,
        -0.168,
        -0.426
      ],
      turn: [
        0.988,
        1.04,
        -0.335
      ]
    },
    bash: {
      at: [
        0.35,
        -0.247,
        -0.316
      ],
      turn: [
        -0.262,
        -0.22,
        0.35
      ]
    },
    crouch: -0.015,
    pouch: [
      0.052,
      -0.513,
      -0.288
    ],
    mainRoll: 2.094,
    offRoll: -2.045,
    magRoll: -0.82,
    boltRoll: 1.04,
    loadRoll: 0.56,
    offShift: [
      0.078,
      0.077,
      0.002
    ],
    offTilt: -0.938,
    shoulderR: [
      0.035,
      0.037,
      -0.058
    ],
    shoulderL: [
      0.079,
      0.075,
      0.064
    ],
    adsShoulderR: [
      -0.068,
      0.053,
      -0.083
    ],
    adsShoulderL: [
      -0.057,
      0.102,
      -0.029
    ],
    adsMainRoll: -0.45,
    adsOffRoll: -0.1
  },
  launcher_rpg: {
    hip: [
      0.14,
      -0.14,
      -0.127
    ],
    converge: 20,
    relief: 0.15,
    adsDrop: 0,
    sprint: {
      at: [
        0.03,
        -0.2,
        -0.1
      ],
      turn: [
        -0.8,
        0.5,
        0.138
      ]
    },
    wall: {
      at: [
        0.123,
        -0.161,
        0.006
      ],
      turn: [
        1.611,
        -0.243,
        -2.464
      ]
    },
    reload: {
      at: [
        0.055,
        -0.23,
        -0.08
      ],
      turn: [
        -0.225,
        0.162,
        0.05
      ]
    },
    lowered: {
      at: [
        0.105,
        -0.5,
        -0.245
      ],
      turn: [
        -0.425,
        -0.112,
        0.638
      ]
    },
    inspectA: {
      at: [
        0.135,
        -0.395,
        -0.227
      ],
      turn: [
        -0.275,
        -0.625,
        0.775
      ]
    },
    inspectB: {
      at: [
        0.015,
        -0.345,
        -0.185
      ],
      turn: [
        -0.025,
        -0.075,
        0.575
      ]
    },
    bash: {
      at: [
        0.145,
        -0.352,
        -0.28
      ],
      turn: [
        -0.2,
        -0.55,
        0.75
      ]
    },
    crouch: -0.02,
    pouch: [
      -0.447,
      -0.653,
      -0.46
    ],
    mainRoll: -1.396,
    offRoll: -2.793,
    magRoll: 0,
    boltRoll: 0.075,
    loadRoll: -1.23,
    offShift: [
      0,
      0.01,
      0.015
    ],
    offTilt: -0.15,
    shoulderR: [
      -0.064,
      0.058,
      0.029
    ],
    shoulderL: [
      -0.002,
      0.025,
      0.089
    ],
    adsShoulderR: [
      0.099,
      0.09,
      -0.027
    ],
    adsShoulderL: [
      -0.064,
      0.097,
      -0.1
    ],
    adsMainRoll: -0.1,
    adsOffRoll: 0.54
  },
  rifle_m4a1: {
    hip: [
      0.155,
      -0.16,
      -0.267
    ],
    converge: 12,
    relief: 0.152,
    adsDrop: 0.02,
    sprint: {
      at: [
        0.08,
        -0.26,
        -0.22
      ],
      turn: [
        -0.4,
        0.5,
        -0.25
      ]
    },
    wall: {
      at: [
        0.176,
        -0.283,
        -0.096
      ],
      turn: [
        0.32,
        0.112,
        0.12
      ]
    },
    reload: {
      at: [
        0.002,
        -0.281,
        0.022
      ],
      turn: [
        2.041,
        0.956,
        0.026
      ]
    },
    lowered: {
      at: [
        0.27,
        -0.492,
        0.098
      ],
      turn: [
        0.015,
        1.323,
        -0.27
      ]
    },
    inspectA: {
      at: [
        0.34,
        -0.341,
        -0.012
      ],
      turn: [
        0.43,
        -0.134,
        -0.65
      ]
    },
    inspectB: {
      at: [
        0.267,
        -0.42,
        -0.009
      ],
      turn: [
        0.67,
        1.403,
        0.325
      ]
    },
    bash: {
      at: [
        0.147,
        -0.21,
        -0.395
      ],
      turn: [
        -0.2,
        0.325,
        -0.025
      ]
    },
    crouch: -0.02,
    pouch: [
      -0.099,
      -0.137,
      -0.098
    ],
    mainRoll: 1.607,
    offRoll: 3.14,
    magRoll: -1.095,
    boltRoll: 0.935,
    loadRoll: 1.225,
    offShift: [
      0.059,
      0.033,
      0.046
    ],
    offTilt: 1.403,
    shoulderR: [
      0.024,
      0.073,
      0.1
    ],
    shoulderL: [
      -0.01,
      0.073,
      -0.019
    ],
    adsShoulderR: [
      0.053,
      0.071,
      -0.063
    ],
    adsShoulderL: [
      -0.014,
      0.063,
      0.099
    ],
    adsMainRoll: 1.775,
    adsOffRoll: 0.69
  },
  rifle_ak: {
    hip: [
      0.148,
      -0.2,
      -0.247
    ],
    converge: 12,
    relief: 0.255,
    adsDrop: 0.02,
    sprint: {
      at: [
        0.08,
        -0.17,
        -0.175
      ],
      turn: [
        -0.625,
        0.35,
        -0.1
      ]
    },
    wall: {
      at: [
        -0.055,
        -0.245,
        -0.065
      ],
      turn: [
        0.85,
        0.325,
        0.45
      ]
    },
    reload: {
      at: [
        -0.03,
        -0.08,
        -0.25
      ],
      turn: [
        0.725,
        0.4,
        -0.4
      ]
    },
    lowered: {
      at: [
        0.15,
        -0.465,
        -0.18
      ],
      turn: [
        -0.75,
        0.575,
        0
      ]
    },
    inspectA: {
      at: [
        0.25,
        -0.15,
        -0.21
      ],
      turn: [
        -0.15,
        0.425,
        0.575
      ]
    },
    inspectB: {
      at: [
        0.225,
        -0.255,
        -0.075
      ],
      turn: [
        0.5,
        -0.45,
        0.175
      ]
    },
    bash: {
      at: [
        0.18,
        -0.205,
        -0.28
      ],
      turn: [
        -0.075,
        0.55,
        0.275
      ]
    },
    crouch: -0.02,
    pouch: [
      -0.195,
      -0.483,
      -0.02
    ],
    mainRoll: -2.493,
    offRoll: -2.743,
    magRoll: -1.2,
    boltRoll: 1.25,
    loadRoll: 0.45,
    offShift: [
      0.041,
      0.082,
      0.039
    ],
    offTilt: 0.975,
    shoulderR: [
      -0.02,
      0.073,
      0.093
    ],
    shoulderL: [
      -0.014,
      0.1,
      0.026
    ],
    adsShoulderR: [
      0.015,
      0.097,
      0.017
    ],
    adsShoulderL: [
      -0.095,
      0.1,
      0.097
    ],
    adsMainRoll: 1.45,
    adsOffRoll: 0.4
  }
};

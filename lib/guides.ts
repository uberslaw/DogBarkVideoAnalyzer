export const FRIGATE_CONFIG = `# RLC-810WA — 4K H.265, built-in microphone.
# Frigate's Reolink guide puts older 8MP RLC cameras on RTSP.
# In the Reolink app: turn the microphone on, or the stream is silent.
# If RTSP drops frames, use the http-flv lines from
# https://docs.frigate.video/configuration/camera_specific/#reolink

go2rtc:
  streams:
    backyard:
      - rtsp://USER:PASSWORD@CAMERA_IP:554/Preview_01_main
      - ffmpeg:backyard#audio=opus
    backyard_sub:
      - rtsp://USER:PASSWORD@CAMERA_IP:554/Preview_01_sub

cameras:
  backyard:
    ffmpeg:
      output_args:
        # The default record preset drops audio. This one keeps AAC.
        record: preset-record-generic-audio-aac
      inputs:
        - path: rtsp://127.0.0.1:8554/backyard
          input_args: preset-rtsp-restream
          roles:
            - record
            - audio
        - path: rtsp://127.0.0.1:8554/backyard_sub
          input_args: preset-rtsp-restream
          roles:
            - detect
    detect:
      width: 1280
      height: 720
      fps: 5
    objects:
      track:
        - person
        - dog
    audio:
      enabled: true
      # Watch Debug → Audio and raise this if the mic hiss triggers constantly.
      # 200 is sensitive, 500 is moderate, 1000 is strict.
      min_volume: 200
      listen:
        - bark
        - howl
        - dog
        - growling
      filters:
        bark:
          threshold: 0.7
    record:
      enabled: true
      retain:
        days: 7
        mode: all

mqtt:
  enabled: true
  host: HOME_ASSISTANT_IP
`;

export const HOME_ASSISTANT_AUTOMATION = `automation:
  - alias: Dog started barking
    mode: single
    triggers:
      - trigger: mqtt
        topic: frigate/events
    conditions:
      - condition: template
        value_template: >-
          {{ trigger.payload_json['type'] == 'new'
             and trigger.payload_json['after']['label']
                in ['bark', 'howl', 'dog', 'growling'] }}
    actions:
      - action: notify.mobile_app_PHONE
        data:
          title: Barking
          message: >-
            {{ trigger.payload_json['after']['label'] }} on
            {{ trigger.payload_json['after']['camera'] }}
`;

import { dismissAlarm, getTimerView, pauseTimer, resumeTimer, stopTimer, subscribeTimer } from '../../lib/store'

const unsubscribers = new WeakMap<object, () => void>()

Component({
  properties: {
    offsetTop: {
      type: Number,
      value: 88,
    },
  },
  data: {
    visible: false,
    title: '',
    clock: '',
    alarm: false,
    running: false,
  },
  lifetimes: {
    attached() {
      this.sync()
      unsubscribers.set(this, subscribeTimer(() => this.sync()))
    },
    detached() {
      const unsubscribe = unsubscribers.get(this)
      if (unsubscribe) unsubscribe()
      unsubscribers.delete(this)
    },
  },
  methods: {
    sync() {
      this.setData(getTimerView())
    },
    onPause() {
      pauseTimer()
    },
    onResume() {
      resumeTimer()
    },
    onStop() {
      stopTimer()
    },
    onDismiss() {
      dismissAlarm()
    },
  },
})

Page({
  data: {
    step: "input", // input | thinking | result
    formData: {
      cause: "",
      nameA: "",
      nameB: "",
      sideA: "",
      sideB: "",
    },
    result: null,
  },

  onInput(e: any) {
    const { field } = e.currentTarget.dataset;
    this.setData({
      [`formData.${field}`]: e.detail.value,
    });
  },

  async submitForm() {
    if (!this.data.formData.cause) {
      wx.showToast({ title: "请填写案发经过", icon: "none" });
      return;
    }

    this.setData({ step: "thinking" });

    try {
      const { cause, nameA, nameB, sideA, sideB } = this.data.formData;
      const payload = {
        cause,
        nameA: nameA || "小笨蛋A",
        nameB: nameB || "大傻瓜B",
        sideA,
        sideB,
      };

      // @ts-ignore
      const res = await wx.cloud.callContainer({
        config: {
          env: "service-60s-8g69apg2ef1b45c8",
        },
        path: "/api/cat-judgement",
        header: {
          "X-WX-SERVICE": "ai-service",
        },
        method: "POST",
        data: payload,
      });

      if (res.statusCode !== 200 || res.data.code !== 0) {
        throw new Error(res.data?.message || "API Error");
      }

      this.setData({
        result: res.data.data,
        step: "result",
      });
    } catch (err: any) {
      console.error(err);
      wx.showModal({
        title: "错误",
        content: "猫猫法官去睡觉了，请稍后再试喵！",
        showCancel: false,
      });
      this.setData({ step: "input" });
    }
  },

  resetForm() {
    this.setData({
      step: "input",
      result: null,
      formData: {
        cause: "",
        nameA: "",
        nameB: "",
        sideA: "",
        sideB: "",
      },
    });
  },
});

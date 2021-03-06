/**
 * Created by santi8ago8 on 04/10/14.
 */



sA.directive('userconfig', ['SocketController', function (SocketController) {

    var ctr = function ($scope, $element) {

        $scope.draging = false;
        $scope.dragInsideImage = false;
        $scope.closed = false;
        $scope.incType = false;
        $scope.editPass = false;
        $scope.userC = {};//pass = "";
        var figure;

        $scope.show = function () {
            figure = angular.element($element[0].querySelector('figure'));
            figure.on('dragover', $scope.dragHover);
            figure.on('drop', $scope.drop);

            window.addEventListener('dragenter', $scope.dragStart);
            window.addEventListener('dragend', $scope.dragLeave);
            window.addEventListener('drop', $scope.dragLeave);
            $scope.$root.$on('comm:get', $scope.commands);

        };
        $scope.dragStart = function (e) {
            e.preventDefault();
            $scope.draging = true;
            $scope.$apply();
        };
        $scope.dragLeave = function (e) {
            e.preventDefault();
            $scope.draging = false;
            $scope.dragInsideImage = false;
            $scope.$apply();
        };
        $scope.dragHover = function (e) {
            e.preventDefault();
        };
        $scope.drop = function (e) {
            $scope.incType = false;
            var file = e.dataTransfer.files[0];
            if (file.type == 'image/jpeg' || file.type == 'image/png' || file.type == 'image/gif') {

                var reader = new FileReader();
                reader.onload = function (ev) {
                    var data = ev.target.result.replace(/^[^,]*,/, '');
                    SocketController.sendToSocket('binding',
                        {id: 'user:picture', data: data, type: file.type});
                };
                reader.readAsDataURL(file);
            } else {
                $scope.incType = true;
            }

            $scope.$apply();
        };
        $scope.closeBtn = function () {
            $scope.$root.$emit('cfgTC:close');
        };
        $scope.editPassFn = function () {
            $scope.editPass = !$scope.editPass;
        };
        $scope.savePass = function () {
            $scope.editPass = !$scope.editPass;
            SocketController.sendToSocket('binding', {
                id: 'user:password',
                password: $scope.userC.pass
            });
        };

        $scope.editCmd = false;
        $scope.commands = [];
        $scope.editCommands = function () {

            //request to socket.
            SocketController.binding('comm:get');

        };
        $scope.commands = function (_, data) {
            $scope.$apply(function () {
                $scope.editCmd = true;
                $scope.commands = data.commands;
                $scope.commands.push({command: ''});
            });
        };
        $scope.add = function () {
            $scope.commands.push({command: ''});
        };
        $scope.saveCmmds = function () {
            $scope.editCmd = false;
            var res = [];
            angular.forEach($scope.commands, function (it) {
                if (it.command != '' || it["_id"]) {
                    delete it["$$hashKey"];
                    res.push(it);
                }
            });
            SocketController.binding('comm:save', {commands: res});
        };


        $scope.$on('destroy', function () {
            window.removeEventListener('dragenter', $scope.dragStart);
            window.removeEventListener('dragend', $scope.dragLeave);
            window.removeEventListener('drop', $scope.dragLeave);
            $scope.$root.$off('comm:get', $scope.commands);
        });
    };


    return {
        restrict: 'E',
        replace: false,
        controller: ctr,
        templateUrl: '/html/t_userConfig.html',
        link: function (scope, $element, attrs) {
            scope.show();
        }
    }
}]);